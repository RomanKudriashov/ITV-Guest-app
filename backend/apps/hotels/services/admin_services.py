"""
Сервисный слой админки отеля: номера, локации, отделы.

Логика в сервисах, вьюхи тонкие. Тенант нигде не фильтруется руками —
менеджеры скоупят, RLS страхует.
"""

from __future__ import annotations

import re
import uuid

from typing import Any, Iterable

from django.db import transaction

from apps.catalog.models import Category, ServiceLocation
from apps.accounts.services.roles import (
    HotelAdminOnly,
    current_access,
    require_hotel_admin,
    require_point_scope,
)
from apps.core.context import require_hotel_id
from apps.core.errors import ConflictError, NotFoundError, ValidationError
from apps.core.fields import translate
from apps.accounts.models import GuestSession
from apps.core.models import AuditLog
from apps.media.models import MediaAsset
from apps.media.services import serialize_asset

from apps.hotels.models import (
    ExecutionPoint,
    Hotel,
    Location,
    Room,
    RoomCategory,
    Schedule,
    Service,
)
from apps.hotels.models.room import natural_number_key
from apps.hotels.venue_defaults import service_type_for_kind

MAX_BULK_RANGE = 500


# --- Номера ----------------------------------------------------------------


def serialize_room(
    room: Room, *, hotel: Hotel | None = None, control_types: dict | None = None
) -> dict:
    hotel = hotel or room.hotel
    return {
        "id": str(room.pk),
        "number": room.number,
        "floor": room.floor,
        "zone": room.zone,
        "source": room.source,
        "is_active": room.is_active,
        "guest_url": hotel.room_deeplink(room.number),
        # Категория — тарифная, из справочника отеля. `None` — не назначена, и
        # это штатное состояние, а не пробел в данных.
        "category_id": str(room.category_id) if room.category_id else None,
        "category": (
            {
                "id": str(room.category_id),
                "code": room.category.code,
                "title": room.category.title_i18n,
            }
            if room.category_id
            else None
        ),
        "housekeeping": room.housekeeping,
        "out_of_service": room.out_of_service,
        # ТИП УПРАВЛЕНИЯ — тот единственный вопрос про GRMS, который админ
        # отеля задаёт, глядя на список номеров: «а этот номер вообще
        # управляется?». `None` — не управляется, и это штатный ответ.
        #
        # Одиночная выдача карту не получает и отвечает `None`: гонять запрос
        # ради одной строки дороже, чем не показывать колонку там, где её и нет.
        "control_type": (control_types or {}).get(room.pk),
        # Номер не заведён заново, а ВОЗВРАЩЁН из удалённых — вместе со своей
        # историей. Экран обязан сказать это вслух: «создан» и «восстановлен»
        # для администратора разные события.
        "restored": bool(getattr(room, "_restored", False)),
        "restored_orders": int(getattr(room, "_restored_orders", 0)),
        "restored_sessions": int(getattr(room, "_restored_sessions", 0)),
        "revoked_sessions": int(getattr(room, "_revoked_sessions", 0)),
    }


# Фильтры выборки — ОДИН СПИСОК НА ВЕСЬ ФОНД. Им пользуются и список, и
# массовая правка: «выделить всё по выборке» обязано означать ровно то же
# множество, которое человек видит на экране, иначе правка уедет не туда.
ROOM_FILTERS = (
    "floor",
    "zone",
    "category",
    "housekeeping",
    "out_of_service",
    # Эти два показывает только сетка — на кубике видно и заказы, и
    # оборудование, — но считает их СЕРВЕР, наравне с остальными. Иначе
    # «выбрать все N в выборке» посчитало бы одно множество, а погасило другое.
    "has_orders",
    "has_control",
)


def rooms_queryset(*, search: str = "", filters: dict | None = None):
    """Выборка номеров по поиску и фильтрам — общая для чтения и правки."""
    from apps.core.listing import search as apply_search

    filters = filters or {}
    rooms = Room.objects.select_related("category")

    if filters.get("floor"):
        rooms = rooms.filter(floor=filters["floor"])
    if filters.get("zone"):
        rooms = rooms.filter(zone=filters["zone"])
    if filters.get("category"):
        # «none» — номера БЕЗ категории: их надо уметь найти, чтобы назначить.
        value = filters["category"]
        rooms = rooms.filter(category__isnull=True) if value == "none" else rooms.filter(
            category_id=value
        )
    if filters.get("housekeeping"):
        rooms = rooms.filter(housekeeping=filters["housekeeping"])
    if filters.get("out_of_service") is not None:
        rooms = rooms.filter(out_of_service=filters["out_of_service"])

    if filters.get("has_orders"):
        from django.db.models import Exists, OuterRef

        from apps.orders.models import Order

        # Та же выборка, что на кубике и на доске: агрегат фан-аута
        # исполнением не является, иначе «есть заказы» зажглось бы у комнаты,
        # где на самом деле работают дочерние точки.
        active = Order.objects.filter(
            room_id=OuterRef("pk"), status__is_terminal=False, children__isnull=True
        )
        rooms = rooms.filter(Exists(active))

    if filters.get("has_control"):
        try:
            from apps.grms.models import RoomTypeRoom
        except ImportError:  # pragma: no cover — модуль GRMS не собран
            rooms = rooms.none()
        else:
            rooms = rooms.filter(
                pk__in=RoomTypeRoom.objects.values_list("room_id", flat=True)
            )

    return apply_search(rooms.order_by("sort_key", "number"), search, ("number", "floor"))


def list_rooms(
    *, search: str = "", limit: int | None = None, offset: int = 0, filters: dict | None = None
) -> dict:
    """
    Поиск по НОМЕРУ и ЭТАЖУ — единственное, что о номере помнят наизусть.

    ЧТЕНИЕ ЗАКРЫТО АДМИНОМ, как и запись рядом. Правка номеров давно требовала
    `require_hotel_admin`, а список отдавался любому управляющему — то есть
    фонд номеров отеля читал руководитель одного ресторана. Экран «Номера»
    ему и так не показан (пункт меню `hotel_admin_only`), так что закрытие
    ручки ничего у него не отнимает: оно лишь перестаёт отдавать то, за чем он
    не может прийти по интерфейсу.
    """
    from apps.core.listing import page as list_page

    require_hotel_admin()

    hotel = Hotel.objects.get(pk=require_hotel_id())
    # Порядок — по ключу натуральной сортировки (`Room.sort_key`), а не по
    # строке номера: иначе `12` встаёт после `101`. Ключ считается из номера
    # в одном месте, `hotels/models/room.py`.
    rooms = rooms_queryset(search=search, filters=filters)
    control_types = _control_types()
    return list_page(
        rooms,
        limit=limit,
        offset=offset,
        serialize=lambda room: serialize_room(room, hotel=hotel, control_types=control_types),
    )


def _control_types() -> dict:
    """
    Номер → код типа управления, ОДНИМ запросом на страницу.

    Спрашивать тип у каждой строки значило бы получить сотню запросов на список
    из сотни номеров. Модуль может быть выключен или таблиц может не быть вовсе
    — тогда карта пустая, и колонка просто везде показывает прочерк.
    """
    try:
        from apps.grms.models import RoomTypeRoom
    except ImportError:  # pragma: no cover — модуль GRMS не собран
        return {}

    return dict(
        RoomTypeRoom.objects.select_related("room_type").values_list(
            "room_id", "room_type__code"
        )
    )


def get_room(room_id) -> Room:
    """
    Единственная дверь к одному номеру: правка, удаление, выезд гостя и оба
    QR ходят через неё. Поэтому проверка стоит здесь, а не в четырёх вьюхах —
    пятая однажды забудет её позвать.
    """
    require_hotel_admin()
    room = Room.objects.filter(pk=room_id).first()
    if room is None:
        raise NotFoundError("Номер не найден")
    return room


@transaction.atomic
def create_room(data: dict) -> Room:
    """
    Завести номер — или ВЕРНУТЬ мягко удалённый с тем же именем.

    Имя занимал удалённый номер. Проверка шла по `all_objects`, то есть по
    живым И удалённым: комнату 305 удалили — и 305 больше не заводилась
    никогда, хотя на экране её нет. Ограничение в базе говорило то же самое.

    Возврат, а не вторая строка с тем же номером: 305 — это одна физическая
    комната, и её история (заказы, сессии, чат) уже ссылается на ту строку.
    Заведя дубль, мы получили бы два «305» в отчётах и разошедшуюся историю.

    ЧТО ПРИ ВОЗВРАТЕ ГАСИТСЯ. PIN проживания и живые гостевые сессии — это
    доступ прежнего гостя, и переживать удаление комнаты он не должен: иначе
    «удалили и завели заново» тихо вернёт чужому телефону право заказывать и
    управлять номером. Привязка к типу GRMS, наоборот, остаётся: оборудование
    из комнаты никуда не уехало.
    """
    require_hotel_admin()
    number = str(data.get("number") or "").strip()
    if not number:
        raise ValidationError("Укажите номер", field="number")
    if Room.objects.filter(number=number).exists():
        raise ConflictError(f"Номер «{number}» уже существует", code="room_exists")

    floor = str(data.get("floor") or "").strip()
    zone = str(data.get("zone") or "").strip()
    is_active = data.get("is_active", True)
    extra = _room_fields(data)

    buried = Room.all_objects.filter(number=number, deleted_at__isnull=False).first()
    if buried is not None:
        buried.floor = floor
        buried.zone = zone
        buried.is_active = is_active
        for field, value in extra.items():
            setattr(buried, field, value)
        buried.deleted_at = None
        buried.save()

        # ЧТО ИМЕННО ВЕРНУЛОСЬ — ЧИСЛАМИ. «Восстановлен вместе с историей» не
        # отвечает на вопрос человека, который нажал «добавить номер»: он не
        # просил ничего восстанавливать и не знает, что получил. История
        # считается ДО отзыва доступа — отзыв её не трогает, но порядок здесь
        # важен для читающего не меньше, чем для результата.
        from apps.orders.models import Order

        buried._restored = True
        buried._restored_orders = Order.objects.filter(room=buried).count()
        buried._restored_sessions = GuestSession.objects.filter(room=buried).count()
        revoked = _drop_stale_access(buried)
        buried._revoked_sessions = revoked

        AuditLog.record(
            "room.restored",
            object_type="room",
            object_id=buried.pk,
            payload={
                "number": number,
                "orders": buried._restored_orders,
                "sessions": buried._restored_sessions,
                "revoked": revoked,
            },
        )
        return buried

    return Room.objects.create(
        number=number,
        floor=floor,
        zone=zone,
        is_active=is_active,
        **extra,
    )


def _room_fields(data: dict) -> dict:
    """
    Поля фонда из запроса — в одном месте: их правят и поштучно, и пачкой, и
    при возврате удалённого номера. Разъехавшиеся проверки здесь означали бы,
    что массовая правка принимает то, что одиночная отвергает.
    """
    fields: dict = {}

    if "category_id" in data:
        value = data.get("category_id")
        fields["category"] = _category_or_none(value)
    if "housekeeping" in data and data.get("housekeeping") is not None:
        value = str(data["housekeeping"])
        if value not in Room.Housekeeping.values:
            raise ValidationError(
                f"Неизвестное состояние уборки «{value}»", field="housekeeping"
            )
        fields["housekeeping"] = value
    if "out_of_service" in data and data.get("out_of_service") is not None:
        fields["out_of_service"] = bool(data["out_of_service"])

    return fields


def _category_or_none(value):
    """Категория по идентификатору — или `None`, если её снимают."""
    if not value:
        return None
    category = RoomCategory.objects.filter(pk=value).first()
    if category is None:
        raise ValidationError("Категория не найдена", field="category_id")
    return category


def _drop_stale_access(room: Room) -> int:
    """
    Снять доступ, оставшийся от прежнего проживания: PIN и живые сессии.
    Возвращает, сколько сессий погашено, — это часть ответа пользователю.

    Живёт здесь, а не в GRMS, по той же причине, что и «выезд»: отелю без
    оборудования это нужно ровно так же, а PIN — лишь одна из двух частей.
    """
    from apps.accounts.services.guest_checkout import check_out_room as revoke

    result = revoke(room.hotel, room)

    try:
        from apps.grms.models import RoomPin
    except ImportError:  # pragma: no cover — модуль GRMS не собран
        return result.revoked
    RoomPin.all_objects.filter(room=room).hard_delete()
    return result.revoked


def _grms_link(room: Room):
    """
    Привязка комнаты к типу GRMS или `None` — БЕЗ жёсткой зависимости на модуль.

    Тот же приём, что у `_control_types`: направление зависимости остаётся
    grms → hotels, и на сборке без GRMS номерной фонд работает как ни в чём не
    бывало.
    """
    try:
        from apps.grms.models import RoomTypeRoom
    except ImportError:  # pragma: no cover — модуль GRMS не собран
        return None
    return (
        RoomTypeRoom.objects.select_related("room_type").filter(room=room).first()
    )


def _device_name(link, number: str) -> str:
    """Имя устройства iRidi для комнаты: переопределение важнее шаблона."""
    if link is None:
        return ""
    return link.device_name_override or (
        (link.room_type.device_name_template or "").replace("{room}", number)
    )


def rename_impact(room_id, number: str) -> dict:
    """
    Что случится, если переименовать номер. ТОЛЬКО ЧТЕНИЕ.

    Два последствия неочевидны настолько, что молча переименовывать нельзя:

      * QR КОДИРУЕТ НОМЕР, а не идентификатор (`/r/<номер>`). Наклейка висит
        на стене В НОМЕРЕ: после переименования она ведёт на несуществующий
        номер и гость получает «номер не найден» вместо витрины. Лечится
        только перепечаткой — из интерфейса это не видно никак;
      * ИМЯ УСТРОЙСТВА iRidi СОБИРАЕТСЯ ИЗ НОМЕРА: шаблон типа подставляет
        `{room}`. Переименовали комнату — команды уходят на устройство с
        другим именем, то есть в никуда, и экран номера честно краснеет
        «Нет связи». Лечится переопределением имени на связи (`keep_device`).

    Остальные ссылки по идентификатору и переименование переживают: заказы,
    сессии, чат, привязка к типу.
    """
    require_hotel_admin()
    room = get_room(room_id)
    hotel = room.hotel
    number = str(number or "").strip()

    link = _grms_link(room)
    device_now = _device_name(link, room.number)
    device_after = _device_name(link, number)

    from django.utils import timezone

    # ЖИВАЯ — это не «не погашенная». Сессия живёт 12 часов и протухает сама,
    # а в номере за год их накапливаются тысячи: на стенде у комнаты 305 таких
    # 20 363, и диалог сообщил бы администратору «20 363 живые сессии» там, где
    # их одна. Считаем ровно то же, что считает `GuestSession.is_valid`.
    live_sessions = GuestSession.objects.filter(
        room=room, revoked_at__isnull=True, expires_at__gt=timezone.now()
    ).count()
    has_pin = False
    try:
        from apps.grms.models import RoomPin

        has_pin = RoomPin.objects.filter(room=room).exists()
    except ImportError:  # pragma: no cover — модуль GRMS не собран
        pass

    return {
        "number": room.number,
        "new_number": number,
        "taken": bool(
            number and Room.objects.filter(number=number).exclude(pk=room.pk).exists()
        ),
        # QR: старая ссылка перестаёт работать, новую надо напечатать.
        "qr_url": hotel.room_deeplink(room.number),
        "qr_url_after": hotel.room_deeplink(number) if number else "",
        # Оборудование: пусто — комната не управляется, предупреждать не о чем.
        "device": device_now,
        "device_after": device_after,
        "device_changes": bool(device_now) and device_now != device_after,
        "live_sessions": live_sessions,
        "has_pin": has_pin,
    }


@transaction.atomic
def update_room(room_id, data: dict) -> Room:
    """
    Правка номера. Переименование — ТОЛЬКО с явным подтверждением.

    ПОЧЕМУ ПРЕДУПРЕЖДАЕМ, А НЕ ЗАПРЕЩАЕМ. Переименование — законное действие:
    после ремонта этаж перенумеровывают, корпуса сливают, «305» становится
    «3005». Запрет не отменил бы задачу, а увёл бы её на обходной путь —
    «удалить и завести заново», — который дороже и опаснее: удаление мягкое,
    история заказов остаётся при СТАРОЙ строке, PIN и привязка к типу уезжают
    вместе с ней, а новая комната приходит пустой. Запрет прогнал бы человека
    мимо единственного места, где можно показать последствия.

    А показать надо ровно два: наклейку QR придётся перепечатать, и имя
    устройства iRidi изменится. Оба невидимы из интерфейса и оба ломают
    продукт молча — поэтому `confirm_rename` обязателен, а не «галочка по
    умолчанию».
    """
    require_hotel_admin()
    room = get_room(room_id)
    if "number" in data:
        number = str(data["number"] or "").strip()
        if not number:
            raise ValidationError("Укажите номер", field="number")
        if number != room.number:
            if Room.objects.filter(number=number).exclude(pk=room.pk).exists():
                raise ConflictError(f"Номер «{number}» уже существует", code="room_exists")

            impact = rename_impact(room.pk, number)
            if not data.get("confirm_rename"):
                raise ConflictError(
                    f"Переименование «{room.number}» → «{number}» меняет ссылку QR"
                    + (" и имя устройства" if impact["device_changes"] else "")
                    + " — нужно подтверждение",
                    code="rename_needs_confirmation",
                    impact=impact,
                )

            # «Оборудование не трогаем»: закрепляем за связью ИМЕННО ТО имя,
            # по которому команды уходят сейчас. Без этого номер переименован,
            # а номер перестал управляться — и виноватым выглядит GRMS.
            if data.get("keep_device_name") and impact["device_changes"]:
                link = _grms_link(room)
                link.device_name_override = impact["device"]
                link.save(update_fields=["device_name_override", "updated_at"])

            AuditLog.record(
                "room.renamed",
                object_type="room",
                object_id=room.pk,
                payload={
                    "from": room.number,
                    "to": number,
                    "device": impact["device"],
                    "device_kept": bool(
                        data.get("keep_device_name") and impact["device_changes"]
                    ),
                    "qr_reprint": True,
                },
            )
        room.number = number
    if "floor" in data:
        room.floor = str(data["floor"] or "").strip()
    if "zone" in data:
        room.zone = str(data["zone"] or "").strip()
    if "is_active" in data:
        room.is_active = data["is_active"]
    for field, value in _room_fields(data).items():
        setattr(room, field, value)
    room.save()
    return room


def delete_room(room_id) -> None:
    require_hotel_admin()
    get_room(room_id).delete()


def parse_room_spec(spec: str) -> list[str]:
    """
    Строка заведения → список номеров. «101-105, 3А, Люкс-1».

    ЗАЧЕМ НЕ ПРОСТО «С» И «ПО». Диапазон целых чисел покрывает регулярный
    корпус и не покрывает ничего больше: реальный фонд — это ещё «3А» после
    ремонта и «Люкс-1» с террасой. Такие номера заводили поштучно, а из-за
    этого фонд заводили не целиком.

    ПРАВИЛА, наружу их видно по ошибкам:
      * диапазон — только между ЦЕЛЫМИ: «101-105». Ширина сохраняется по
        левой границе, «008-012» даёт 008…012, а не 8…12;
      * всё прочее — номер как написан, с буквами и пробелами внутри;
      * повторы внутри самой строки схлопываются, порядок ввода сохраняется:
        человек видит свой список, а не пересортированный.
    """
    numbers: list[str] = []
    seen: set[str] = set()

    for chunk in re.split(r"[,\n;]", spec or ""):
        token = chunk.strip()
        if not token:
            continue

        bounds = re.fullmatch(r"(\d+)\s*[-–—]\s*(\d+)", token)
        if bounds:
            left, right = bounds.group(1), bounds.group(2)
            start_value, end_value = int(left), int(right)
            if start_value > end_value:
                raise ValidationError(
                    f"В диапазоне «{token}» начало больше конца",
                    field="spec",
                    code="bad_range",
                )
            width = len(left)
            for value in range(start_value, end_value + 1):
                number = str(value).zfill(width)
                if number not in seen:
                    seen.add(number)
                    numbers.append(number)
            continue

        if len(token) > 32:
            raise ValidationError(
                f"Номер «{token[:16]}…» длиннее 32 символов", field="spec"
            )
        if token not in seen:
            seen.add(token)
            numbers.append(token)

    if not numbers:
        raise ValidationError("Список номеров пуст", field="spec")
    return numbers


def preview_bulk_rooms(data: dict) -> dict:
    """
    ПРЕДПРОСМОТР. Ничего не создаёт и создать не может — отдельная функция, а
    не флаг у создания: флаг однажды забудут передать.

    Отвечает полным списком и числами: сколько заведётся, что уже есть. Ровно
    это спасает от опечатки «1-99999» — она не создаёт ничего, а упирается в
    предел и называет его.
    """
    require_hotel_admin()
    numbers = _bulk_numbers(data)
    existing = set(Room.objects.values_list("number", flat=True))

    will_create = [number for number in numbers if number not in existing]
    exists = [number for number in numbers if number in existing]
    buried = set(
        Room.all_objects.filter(
            number__in=will_create, deleted_at__isnull=False
        ).values_list("number", flat=True)
    )

    return {
        "numbers": numbers,
        "will_create": will_create,
        "exists": exists,
        # Эти вернутся с историей, а не заведутся заново, — и об этом честнее
        # сказать ДО, а не тостом после.
        "will_restore": sorted(buried, key=natural_number_key),
        "total": len(numbers),
        "create_count": len(will_create),
        "exists_count": len(exists),
    }


def _bulk_numbers(data: dict) -> list[str]:
    """
    Номера из запроса: свободная строка `spec` или прежняя пара «с/по».

    Старая форма осталась рабочей намеренно: на неё завязаны и интерфейс, и
    проверки, а ломать контракт ради нового поля — это чинить одно и ломать
    другое.
    """
    spec = str(data.get("spec") or "").strip()
    prefix = str(data.get("prefix") or "")
    suffix = str(data.get("suffix") or "")

    if spec:
        numbers = parse_room_spec(spec)
    else:
        try:
            start = int(data["from"])
            end = int(data["to"])
        except (KeyError, TypeError, ValueError):
            raise ValidationError(
                "Границы диапазона должны быть числами", field="from"
            ) from None
        if start > end:
            raise ValidationError(
                "Начало диапазона больше конца", field="from", code="bad_range"
            )
        if end - start + 1 > MAX_BULK_RANGE:
            raise ValidationError(
                f"За один раз не больше {MAX_BULK_RANGE} номеров",
                field="to",
                code="range_too_large",
            )
        numbers = [str(value) for value in range(start, end + 1)]

    numbers = [f"{prefix}{number}{suffix}" for number in numbers]

    if len(numbers) > MAX_BULK_RANGE:
        raise ValidationError(
            f"За один раз не больше {MAX_BULK_RANGE} номеров, а в списке {len(numbers)}",
            field="spec",
            code="range_too_large",
        )
    return numbers


@transaction.atomic
def bulk_create_rooms(data: dict) -> dict:
    """
    Заведение пачкой. Уже существующие пропускаются молча — повторный вызов не
    падает и не двоит: заводить отель по частям это норма.

    Предел проверяется ДО создания и на всём списке сразу: «1-99999» не должно
    создать девяносто тысяч комнат и не должно создать первые пятьсот.
    """
    require_hotel_admin()
    numbers = _bulk_numbers(data)

    floor = str(data.get("floor") or "").strip()
    zone = str(data.get("zone") or "").strip()
    extra = _room_fields(data)

    existing = set(Room.objects.values_list("number", flat=True))
    created, skipped, restored = [], [], []
    to_create = []
    for number in numbers:
        if number in existing:
            skipped.append(number)
            continue

        buried = Room.all_objects.filter(number=number, deleted_at__isnull=False).first()
        if buried is not None:
            # Тот же возврат, что и поштучно: вторая строка с этим номером
            # развела бы отчёты. Доступ прежнего проживания гасится там же.
            buried.floor = floor
            buried.zone = zone
            buried.is_active = True
            for field, value in extra.items():
                setattr(buried, field, value)
            buried.deleted_at = None
            buried.save()
            _drop_stale_access(buried)
            restored.append(number)
            created.append(number)
            continue

        to_create.append(
            Room(
                hotel_id=require_hotel_id(),
                number=number,
                floor=floor,
                zone=zone,
                # `bulk_create` НЕ зовёт `save()`, поэтому ключи сортировки
                # приходится ставить руками. Забыть это — значит получить
                # пачку номеров без ключа, которые уедут в начало списка.
                sort_key=natural_number_key(number),
                floor_key=natural_number_key(floor),
                **extra,
            )
        )
        created.append(number)

    Room.objects.bulk_create(to_create)
    AuditLog.record(
        "room.bulk_created",
        object_type="room",
        payload={"created": len(created), "skipped": len(skipped), "restored": restored},
    )
    return {
        "created": created,
        "skipped": skipped,
        "restored": restored,
        "created_count": len(created),
        "skipped_count": len(skipped),
    }


# --- Сетка номерного фонда --------------------------------------------------


def rooms_grid() -> dict:
    """
    ФОНД ЦЕЛИКОМ, разложенный по корпусам и этажам.

    Без листания намеренно: сетка тем и полезна, что этажи читаются один под
    другим, а страница по пятьдесят кубиков этого не даёт. Предел всё равно
    есть — фонд ограничен тарифом, и молча показать часть мы не имеем права,
    поэтому при упоре в предел выдача честно говорит `truncated`.

    ФИЛЬТРЫ СЮДА НЕ ПЕРЕДАЮТСЯ. На сетке отфильтрованное ГАСИТСЯ, а не
    исчезает: убрав кубики, мы порвём ряды, и соседние номера перестанут
    стоять рядом. Гасит клиент, а сервер отдаёт весь фонд и признаки, по
    которым гасить.
    """
    require_hotel_admin()

    hotel = Hotel.objects.get(pk=require_hotel_id())
    rooms = list(Room.objects.select_related("category").order_by("sort_key", "number")[:GRID_LIMIT])
    truncated = Room.objects.count() > len(rooms)

    control_types = _control_types()
    orders = _active_orders_by_room([room.pk for room in rooms])
    device_state = _device_state()

    # Корпус → этаж → кубики. Ключи сортировки уже посчитаны в модели, поэтому
    # «10» не встаёт перед «9» ни у номера, ни у этажа.
    buildings: dict[str, dict] = {}
    for room in rooms:
        zone = room.zone or ""
        building = buildings.setdefault(zone, {"zone": zone, "floors": {}})
        floor = building["floors"].setdefault(
            room.floor or "", {"floor": room.floor or "", "key": room.floor_key, "rooms": []}
        )
        stats = orders.get(room.pk, {"active": 0, "overdue": 0})
        floor["rooms"].append(
            {
                **serialize_room(room, hotel=hotel, control_types=control_types),
                "active_orders": stats["active"],
                "overdue_orders": stats["overdue"],
                # Состояние оборудования: `null` — номер не управляется вовсе,
                # и это не поломка. Живость канала берётся у он-прем узла, а не
                # опросом каждой комнаты: сто опросов на открытие экрана
                # положили бы и коннектор, и экран.
                "device": device_state if control_types.get(room.pk) else None,
            }
        )

    ordered = []
    for building in sorted(buildings.values(), key=lambda item: item["zone"]):
        floors = sorted(building["floors"].values(), key=lambda item: (item["key"], item["floor"]))
        ordered.append({"zone": building["zone"], "floors": floors})

    return {
        "buildings": ordered,
        "total": len(rooms),
        "truncated": truncated,
        # Занятости НЕТ и не будет до PMS — выдача говорит это прямо, чтобы
        # экран не выдумывал её сам и не красил кубики наугад.
        "occupancy": "unknown",
    }


# Предел сетки. Фонд ограничен тарифом, но упереться в предел молча нельзя.
GRID_LIMIT = 2000


def _active_orders_by_room(room_ids: list) -> dict:
    """
    Активные заказы и просрочка по комнатам — ДВУМЯ запросами на весь фонд.

    Выборка та же, что у доски: агрегат фан-аута исполнением не является, и
    считать его вторым заказом значило бы удваивать каждый разъехавшийся.
    Порог просрочки — общий `effective_sla_minutes`, чтобы число на кубике
    совпадало с числом на доске.
    """
    from datetime import timedelta

    from django.utils import timezone

    from apps.orders.models import Order
    from apps.orders.services.tracker_types import effective_sla_minutes

    if not room_ids:
        return {}

    active = (
        Order.objects.filter(room_id__in=room_ids, status__is_terminal=False)
        .exclude(children__isnull=False)
        # Без `.only()`: отложенные поля вместе с `select_related` дают
        # дозагрузку на каждое обращение к точке — ровно там, где мы просили
        # один запрос вместо сотни.
        .select_related("execution_point")
    )

    now = timezone.now()
    thresholds: dict = {}
    result: dict = {}
    for order in active:
        stats = result.setdefault(order.room_id, {"active": 0, "overdue": 0})
        stats["active"] += 1
        point = order.execution_point
        if point is None:
            continue
        if point.pk not in thresholds:
            thresholds[point.pk] = timedelta(minutes=effective_sla_minutes(point))
        if now - order.created_at >= thresholds[point.pk]:
            stats["overdue"] += 1
    return result


def _device_state() -> str:
    """
    Живость канала оборудования — ОДНА на отель, по он-прем узлу.

    Спрашивать каждую комнату значило бы сто чтений по живому сокету на
    открытие экрана: коннектор отвечает с бюджетом 2,5 с, и экран открывался бы
    минуту. Узел отмечается раз в минуту, три пропуска — уже не икота.
    """
    from apps.hotels.models import OnPremNode

    node = (
        OnPremNode.objects.filter(purpose__in=["grms", "both"], is_revoked=False)
        .order_by("-last_seen_at")
        .first()
    )
    if node is None:
        return "no_node"
    return "online" if node.is_online else "offline"


# --- Массовая правка -------------------------------------------------------


# Что можно править пачкой. НОМЕРА ЗДЕСЬ НЕТ, и это решение: переименование
# требует подтверждения на КАЖДЫЙ номер (наклейка QR и имя устройства iRidi у
# каждого свои), а «подтвердить всё разом» — это ровно то молчание, от
# которого мы ушли в одиночной правке.
BULK_PATCH_FIELDS = ("floor", "zone", "category_id", "housekeeping", "out_of_service", "is_active")


def resolve_selection(selection: dict):
    """
    Выборка для массовой правки — ИЗ ФИЛЬТРОВ, а не из того, что видно.

    «Выделить все» на экране, который показывает 50 строк из 314, выделило бы
    пятьдесят. Поэтому у выделения два и только два вида:

      * `ids` — человек отметил строки руками. Правим ровно их;
      * `all_matching` — «все по текущей выборке». Тогда сервер САМ строит то
        же множество из поиска и фильтров, а клиент не присылает список: он
        его и не видел целиком.

    Третьего вида («все на странице») нет намеренно — это и есть ложь.
    """
    ids = selection.get("ids") or []
    if selection.get("all_matching"):
        return rooms_queryset(
            search=str(selection.get("search") or ""),
            filters=selection.get("filters") or {},
        )
    if not ids:
        raise ValidationError("Не выбрано ни одного номера", field="ids", code="empty_selection")
    return rooms_queryset().filter(pk__in=ids)


@transaction.atomic
def bulk_update_rooms(payload: dict) -> dict:
    """
    Правка пачкой: этаж, корпус, категория, уборка, «вне продажи», активность.

    Отвечает ЧИСЛАМИ по факту, а не по намерению: сколько номеров попало в
    выборку и сколько изменено. Пустая правка — отказ, а не «изменено 0»:
    молчаливый ноль читается как «сделано».
    """
    require_hotel_admin()

    patch = {
        key: value
        for key, value in (payload.get("patch") or {}).items()
        if key in BULK_PATCH_FIELDS and value is not None
    }
    # Именно ЗНАЧЕНИЕ, а не наличие ключа: схема присылает `number: null` в
    # каждом запросе, и проверка по ключу отвергала бы вообще любую правку.
    if (payload.get("patch") or {}).get("number") is not None:
        raise ValidationError(
            "Номер пачкой не меняется: у каждого своя наклейка QR и своё имя "
            "устройства, подтверждать это надо поштучно",
            field="number",
            code="rename_not_bulk",
        )
    if not patch:
        raise ValidationError("Нечего менять", field="patch", code="empty_patch")

    rooms = list(resolve_selection(payload.get("selection") or {}))
    fields = _room_fields(patch)

    changed = 0
    for room in rooms:
        touched = False
        for key in ("floor", "zone"):
            if key in patch:
                value = str(patch[key] or "").strip()
                if getattr(room, key) != value:
                    setattr(room, key, value)
                    touched = True
        if "is_active" in patch and room.is_active != bool(patch["is_active"]):
            room.is_active = bool(patch["is_active"])
            touched = True
        if "category" in fields:
            new_category = fields["category"]
            new_id = new_category.pk if new_category is not None else None
            if room.category_id != new_id:
                room.category = new_category
                touched = True
        for key in ("housekeeping", "out_of_service"):
            if key in fields and getattr(room, key) != fields[key]:
                setattr(room, key, fields[key])
                touched = True
        if touched:
            room.save()
            changed += 1

    AuditLog.record(
        "room.bulk_updated",
        object_type="room",
        payload={"matched": len(rooms), "changed": changed, "patch": sorted(patch)},
    )
    return {"matched": len(rooms), "changed": changed}


# --- Категории номеров -----------------------------------------------------


def serialize_room_category(category: RoomCategory, *, counts: dict | None = None) -> dict:
    return {
        "id": str(category.pk),
        "code": category.code,
        "title": category.title,
        "title_i18n": category.title_i18n,
        "sort_order": category.sort_order,
        "is_active": category.is_active,
        # Сколько номеров на категории — вопрос, который задают перед тем, как
        # её трогать. Одним запросом на весь список, а не по строке.
        "rooms_count": (counts or {}).get(category.pk, 0),
    }


def list_room_categories() -> dict:
    require_hotel_admin()
    from django.db.models import Count

    counts = dict(
        Room.objects.exclude(category__isnull=True)
        .values_list("category_id")
        .annotate(total=Count("id"))
    )
    categories = list(RoomCategory.objects.all())
    return {
        "items": [serialize_room_category(c, counts=counts) for c in categories],
        "total": len(categories),
    }


@transaction.atomic
def create_room_category(data: dict) -> RoomCategory:
    require_hotel_admin()
    title = data.get("title") or {}
    if not any((value or "").strip() for value in title.values()):
        raise ValidationError("Укажите название", field="title")

    code = str(data.get("code") or "").strip() or _category_code_from(title)
    if RoomCategory.objects.filter(code=code).exists():
        raise ConflictError(f"Категория «{code}» уже существует", code="category_exists")

    return RoomCategory.objects.create(
        code=code,
        title=title,
        sort_order=int(data.get("sort_order") or 0),
        is_active=data.get("is_active", True),
    )


def _category_code_from(title: dict) -> str:
    """Код из названия — чтобы оператор не придумывал его сам."""
    from django.utils.text import slugify

    source = title.get("ru") or title.get("en") or next(iter(title.values()), "")
    return slugify(source, allow_unicode=False) or f"cat-{uuid.uuid4().hex[:6]}"


def get_room_category(category_id) -> RoomCategory:
    require_hotel_admin()
    category = RoomCategory.objects.filter(pk=category_id).first()
    if category is None:
        raise NotFoundError("Категория не найдена")
    return category


@transaction.atomic
def update_room_category(category_id, data: dict) -> RoomCategory:
    category = get_room_category(category_id)
    if "title" in data and data["title"] is not None:
        category.title = data["title"]
    if "code" in data and data["code"]:
        code = str(data["code"]).strip()
        if RoomCategory.objects.filter(code=code).exclude(pk=category.pk).exists():
            raise ConflictError(f"Категория «{code}» уже существует", code="category_exists")
        category.code = code
    if "sort_order" in data and data["sort_order"] is not None:
        category.sort_order = int(data["sort_order"])
    if "is_active" in data and data["is_active"] is not None:
        category.is_active = bool(data["is_active"])
    category.save()
    return category


def delete_room_category(category_id) -> None:
    """
    Занятую категорию не удаляем, а называем число.

    Мягкое удаление оставило бы номера со ссылкой на несуществующую строку, и
    на экране они показали бы пустую ячейку вместо «Делюкс» — то есть данные
    выглядели бы потерянными. Пусть сначала переназначат: для этого рядом есть
    массовая правка.
    """
    category = get_room_category(category_id)
    busy = Room.objects.filter(category=category).count()
    if busy:
        raise ConflictError(
            f"На категории {busy} номеров — сначала переназначьте их",
            code="category_in_use",
            rooms_count=busy,
        )
    category.delete()


def room_qr_targets() -> tuple[Hotel, list[Room]]:
    # Печатный лист — это весь фонд номеров отеля разом; он админский тем более.
    require_hotel_admin()
    hotel = Hotel.objects.get(pk=require_hotel_id())
    return hotel, list(Room.objects.filter(is_active=True).order_by("sort_key", "number"))


# --- Локации ---------------------------------------------------------------


def serialize_location(location: Location) -> dict:
    return {
        "id": str(location.pk),
        "code": location.code,
        "kind": location.kind,
        "title": location.title or {},
        "requires_refinement": location.requires_refinement,
        "refinement_label": location.refinement_label or {},
        "schedule_id": str(location.schedule_id) if location.schedule_id else None,
        "sort_order": location.sort_order,
        "is_active": location.is_active,
        "delivery_fee_minor": location.delivery_fee_minor,
    }


def list_locations(*, search: str = "", limit: int | None = None, offset: int = 0) -> dict:
    """
    Локации ищутся по КОДУ и НАЗВАНИЮ.

    Чтение закрыто админом по той же причине, что и у номеров: локации —
    география отеля, а не заведения, их правка уже админская, и живут они на
    экране настроек, которого управляющий не видит.
    """
    from apps.core.listing import page as list_page, search as apply_search

    require_hotel_admin()

    queryset = apply_search(
        Location.objects.order_by("sort_order", "code"), search, ("code",), json_fields=("title",)
    )
    return list_page(queryset, limit=limit, offset=offset, serialize=serialize_location)


def get_location(location_id) -> Location:
    location = Location.objects.filter(pk=location_id).first()
    if location is None:
        raise NotFoundError("Локация не найдена")
    return location


def _clean_translations(value: Any, *, field: str) -> dict:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValidationError("Ожидается объект {язык: значение}", field=field)
    return {str(k): str(v).strip() for k, v in value.items() if v and str(v).strip()}


def _make_location_code(title: dict) -> str:
    from apps.catalog.services.cms import make_code

    return make_code(Location, title, prefix="location")


def _resolve_schedule(schedule_id) -> Schedule | None:
    if not schedule_id:
        return None
    schedule = Schedule.objects.filter(pk=schedule_id).first()
    if schedule is None:
        raise ValidationError("Расписание не найдено", field="schedule_id")
    return schedule


def _validate_refinement(requires: bool, label: dict) -> None:
    if requires and not label:
        raise ValidationError(
            "Локация с уточнением требует подписи поля",
            field="refinement_label",
            code="refinement_label_required",
        )


@transaction.atomic
def create_location(data: dict) -> Location:
    require_hotel_admin()
    title = _clean_translations(data.get("title"), field="title")
    if not title:
        raise ValidationError("Заполните название локации", field="title")
    requires = data.get("requires_refinement", False)
    label = _clean_translations(data.get("refinement_label"), field="refinement_label")
    _validate_refinement(requires, label)

    return Location.objects.create(
        code=data.get("code") or _make_location_code(title),
        kind=data.get("kind", Location.Kind.IN_ROOM),
        title=title,
        requires_refinement=requires,
        refinement_label=label,
        schedule=_resolve_schedule(data.get("schedule_id")),
        sort_order=data.get("sort_order", 0),
        is_active=data.get("is_active", True),
    )


@transaction.atomic
def update_location(location_id, data: dict) -> Location:
    require_hotel_admin()
    location = get_location(location_id)
    if "title" in data:
        title = _clean_translations(data["title"], field="title")
        if not title:
            raise ValidationError("Заполните название локации", field="title")
        location.title = title
    if "kind" in data:
        location.kind = data["kind"]
    if "requires_refinement" in data:
        location.requires_refinement = data["requires_refinement"]
    if "refinement_label" in data:
        location.refinement_label = _clean_translations(data["refinement_label"], field="refinement_label")
    if "schedule_id" in data:
        location.schedule = _resolve_schedule(data["schedule_id"])
    if "sort_order" in data:
        location.sort_order = data["sort_order"]
    if "is_active" in data:
        location.is_active = data["is_active"]
    if "delivery_fee_minor" in data:
        fee = data["delivery_fee_minor"]
        if not isinstance(fee, int) or isinstance(fee, bool) or fee < 0:
            raise ValidationError(
                "Стоимость доставки — неотрицательное целое копеек",
                field="delivery_fee_minor",
                code="out_of_range",
            )
        location.delivery_fee_minor = fee

    _validate_refinement(location.requires_refinement, location.refinement_label or {})
    location.save()
    return location


@transaction.atomic
def delete_location(location_id) -> None:
    """
    Локация удаляется мягко — а её связки в матрице ЖЁСТКО: у связки нет
    истории, а живая связка удалённой локации — мусор, который врёт любому
    подсчёту матрицы (на стенде их набралось 129, по одной на прогон).
    """
    require_hotel_admin()
    location = get_location(location_id)
    ServiceLocation.all_objects.filter(location=location).hard_delete()
    location.delete()


# --- Матрица «категория → локации» -----------------------------------------


def location_matrix(language: str | None = None) -> dict:
    # Матрица «категория → локации» — география отеля; живёт на экране
    # настроек, которого управляющий не видит.
    from apps.catalog.models import OfferingType

    require_hotel_admin()

    locations = list(Location.objects.filter(is_active=True).order_by("sort_order", "code"))
    categories = list(Category.objects.order_by("sort_order", "code"))

    links = {
        (link.category_id, link.location_id): link
        for link in ServiceLocation.objects.all()
    }

    rows = []
    for category in categories:
        cells = []
        for location in locations:
            link = links.get((category.pk, location.pk))
            cells.append(
                {
                    "location_id": str(location.pk),
                    "enabled": bool(link and link.is_enabled),
                    "delivery_modes": list(link.delivery_modes) if link else [],
                }
            )
        rows.append(
            {
                "category_id": str(category.pk),
                "category_title": translate(category.title, language),
                "category_type": category.type,
                "cells": cells,
            }
        )

    return {
        "locations": [
            {"id": str(loc.pk), "code": loc.code, "title": translate(loc.title, language)}
            for loc in locations
        ],
        "rows": rows,
    }


@transaction.atomic
def update_matrix_row(category_id, cells: Iterable[dict]) -> dict:
    require_hotel_admin()
    category = Category.objects.filter(pk=category_id).first()
    if category is None:
        raise ValidationError("Категория не найдена", field="category_id")

    valid_modes = set(dict(ServiceLocation.DeliveryMode.choices))
    for cell in cells:
        location_id = cell.get("location_id")
        location = Location.objects.filter(pk=location_id).first()
        if location is None:
            raise ValidationError("Локация не найдена", field="location_id")

        modes = [mode for mode in (cell.get("delivery_modes") or []) if mode in valid_modes]
        if not cell.get("enabled"):
            # Join-строка матрицы истории не несёт — удаляем жёстко, иначе
            # мягко-удалённая строка блокирует повторное включение уникальным
            # индексом (hotel, category, location).
            ServiceLocation.all_objects.filter(category=category, location=location).hard_delete()
            continue

        # all_objects: оживляем мягко-удалённую связку, а не плодим дубль.
        ServiceLocation.all_objects.update_or_create(
            category=category,
            location=location,
            defaults={"delivery_modes": modes or ["delivery"], "is_enabled": True, "deleted_at": None},
        )

    return location_matrix()




# ===========================================================================
# Сервисы — верхний уровень CMS
# ===========================================================================
#
# До R4 то же самое звалось «отделами» и адресовалось id ТОЧКИ ИСПОЛНЕНИЯ.
# Это было наследство прежней модели: снаружи отель настраивает заведение
# («Панорама»), а не бригаду за ним. Ключ ресурса переехал на сервис, точка
# ушла внутрь — потому что включения (R2) адресуются сервисом, и без его id
# CMS не могла ни показать, ни настроить заимствованный контент.

# Тип сервиса → род исполнителя за ним. Обратная сторона KIND_TO_SERVICE_TYPE:
# отель выбирает ЗАВЕДЕНИЕ, а бригаду под него мы заводим сами.
SERVICE_TYPE_TO_KIND = {
    Service.Type.RESTAURANT: ExecutionPoint.Kind.KITCHEN,
    Service.Type.BAR: ExecutionPoint.Kind.BAR,
    Service.Type.ROOM_SERVICE: ExecutionPoint.Kind.KITCHEN,
    Service.Type.MINIBAR: ExecutionPoint.Kind.OTHER,
    Service.Type.SPA: ExecutionPoint.Kind.SPA,
    Service.Type.POOL: ExecutionPoint.Kind.SPA,
    Service.Type.EXCURSIONS: ExecutionPoint.Kind.RECEPTION,
    Service.Type.TRANSFER: ExecutionPoint.Kind.RECEPTION,
    Service.Type.CONCIERGE: ExecutionPoint.Kind.RECEPTION,
    Service.Type.HOUSEKEEPING: ExecutionPoint.Kind.HOUSEKEEPING,
    Service.Type.INFO: ExecutionPoint.Kind.OTHER,
    Service.Type.CUSTOM: ExecutionPoint.Kind.OTHER,
}

# Разумный порог просрочки на доске по роду работы (минуты). Отель правит.
DEFAULT_SLA = {
    ExecutionPoint.Kind.KITCHEN: 20,
    ExecutionPoint.Kind.BAR: 15,
    ExecutionPoint.Kind.SPA: 30,
    ExecutionPoint.Kind.HOUSEKEEPING: 45,
    ExecutionPoint.Kind.RECEPTION: 10,
    ExecutionPoint.Kind.OTHER: 20,
}


def _resolve_asset(asset_id) -> MediaAsset | None:
    if not asset_id:
        return None
    asset = MediaAsset.objects.filter(pk=asset_id).first()
    if asset is None:
        raise ValidationError("Изображение не найдено", field="image_id")
    return asset


def _count_by_point(queryset) -> dict:
    counts: dict = {}
    for point_id in queryset.values_list("execution_point_id", flat=True):
        counts[point_id] = counts.get(point_id, 0) + 1
    return counts


def counts_for(services: "list[Service]") -> dict:
    """
    Шесть счётчиков карточки сервиса — ОДНОЙ функцией на список и на одиночку.

    Держать их только в списке значило держать два ответа на один вопрос:
    детальная ручка сериализовала сервис без `counts`, и карточка честно
    показывала шесть нулей — «ни категорий, ни персонала, ни канала», — хотя
    рядом в списке у той же строки стояли настоящие числа.

    Мост «сервис → заведение» здесь обязателен: персонал и каналы висят на
    ExecutionPoint, а не на Service, и без него счётчики персонала и каналов
    всегда нули.
    """
    from django.db.models import Count, Q

    from apps.accounts.models import StaffAssignment
    from apps.catalog.models import ServiceInclusion
    from apps.notifications.models import EscalationRule, NotificationChannel

    if not services:
        return {}

    service_ids = [service.pk for service in services]
    point_ids = [service.execution_point_id for service in services]

    categories = dict(
        Category.objects.filter(service_id__in=service_ids)
        .values_list("service_id")
        .annotate(n=Count("id"))
    )
    items = dict(
        Category.objects.filter(service_id__in=service_ids)
        .annotate(n=Count("items", filter=Q(items__deleted_at__isnull=True)))
        .values_list("service_id", "n")
    )
    staff = _count_by_point(
        StaffAssignment.objects.filter(is_active=True, execution_point_id__in=point_ids)
    )
    channels = _count_by_point(
        NotificationChannel.objects.filter(is_active=True, execution_point_id__in=point_ids)
    )
    inclusions = dict(
        ServiceInclusion.objects.filter(including_service_id__in=service_ids)
        .values_list("including_service_id")
        .annotate(n=Count("id"))
    )
    with_rules = set(
        EscalationRule.objects.filter(
            is_active=True, execution_point_id__in=point_ids
        ).values_list("execution_point_id", flat=True)
    )

    return {
        service.pk: {
            "categories": categories.get(service.pk, 0),
            "items": items.get(service.pk, 0),
            "staff": staff.get(service.execution_point_id, 0),
            "channels": channels.get(service.execution_point_id, 0),
            "inclusions": inclusions.get(service.pk, 0),
            "escalation": service.execution_point_id in with_rules,
        }
        for service in services
    }


def serialize_service(service: Service, *, counts: dict | None = None) -> dict:
    """
    Сервис глазами CMS: гостевая идентичность + исполнение + коммерция вместе.

    `tracker_type` отдаём здесь же (R3 выводит его из типа сервиса): админ,
    меняя тип заведения, должен видеть, какой рабочий экран получит персонал,
    а не узнавать это по факту. Там же и `noun` — слово, которым это заведение
    называет содержимое каталога.
    """
    from apps.catalog.nouns import noun_for_service_type
    from apps.orders.services.tracker_types import tracker_type_for_service_type

    counts = counts or {}
    point = service.execution_point
    return {
        "id": str(service.pk),
        "code": service.code,
        "type": service.type,
        "public_name": service.public_name or {},
        "tagline": service.tagline or {},
        "is_guest_facing": service.is_guest_facing,
        "is_active": service.is_active,
        "sort_order": service.sort_order,
        "schedule_id": str(service.schedule_id) if service.schedule_id else None,
        "image": serialize_asset(service.image),
        "tracker_type": tracker_type_for_service_type(service.type),
        # Слово, которым заведение называет содержимое своего каталога:
        # «блюдо» у ресторана, «услуга» у спа. Выводится из типа, как и трекер
        # выше, и по той же причине — см. `apps/catalog/nouns.py`.
        "noun": noun_for_service_type(service.type),
        # Исполнение — внутри: снаружи отель настраивает заведение, а бригада
        # за ним детали реализации.
        "execution_point": {
            "id": str(point.pk),
            "code": point.code,
            "title": point.title or {},
            "kind": point.kind,
            "sla_minutes": point.sla_minutes,
        },
        "commerce": {
            field: getattr(service, field) for field in SERVICE_COMMERCE_FIELDS
        },
        "category_count": counts.get("categories", 0),
        "item_count": counts.get("items", 0),
        "staff_count": counts.get("staff", 0),
        "channel_count": counts.get("channels", 0),
        "inclusion_count": counts.get("inclusions", 0),
        "has_escalation": counts.get("escalation", False),
    }


def list_services(*, search: str = "", limit: int | None = None, offset: int = 0) -> dict:
    from apps.accounts.services.roles import managed_point_ids_or_none

    services = Service.objects.select_related("execution_point", "image").order_by(
        "sort_order", "code"
    )
    managed = managed_point_ids_or_none()
    if managed is not None:
        services = services.filter(execution_point_id__in=managed)
    # Заведение ищут по коду и по гостевому названию (оно переводимое —
    # ищется сразу на всех языках).
    from apps.core.listing import clamp, envelope, search as apply_search

    services = apply_search(services, search, ("code",), json_fields=("public_name",))
    total = services.count()
    limit = clamp(limit)
    services = list(services[max(0, offset) : max(0, offset) + limit])

    counts = counts_for(services)
    rows = [serialize_service(service, counts=counts[service.pk]) for service in services]
    return envelope(rows, total, limit, offset=max(0, offset))


def get_service(service_id) -> Service:
    service = (
        Service.objects.select_related("execution_point", "image")
        .filter(pk=service_id)
        .first()
    )
    if service is None:
        raise NotFoundError("Сервис не найден")
    require_point_scope(service.execution_point_id, what="Сервис")
    return service


def service_templates() -> list[dict]:
    """
    Шаблоны для «+ добавить сервис»: тип, из каких кирпичей собран и какой
    рабочий экран получит персонал. Список строится из самих справочников —
    новый тип сервиса появляется здесь сам, без правки шаблонов.
    """
    from apps.catalog.nouns import noun_for_service_type
    from apps.catalog.offerings import OfferingType
    from apps.hotels.vocabularies import SERVICE_TYPE_LABELS
    from apps.orders.services.tracker_types import tracker_type_for_service_type

    # Из каких кирпичей собран тип — это и есть «шаблон» карты продукта.
    BRICKS = {
        Service.Type.RESTAURANT: [OfferingType.PRODUCT],
        Service.Type.BAR: [OfferingType.PRODUCT],
        Service.Type.ROOM_SERVICE: [OfferingType.PRODUCT],
        Service.Type.MINIBAR: [OfferingType.PRODUCT],
        Service.Type.SPA: [OfferingType.SLOT],
        Service.Type.POOL: [OfferingType.SLOT],
        Service.Type.EXCURSIONS: [OfferingType.SLOT],
        Service.Type.TRANSFER: [OfferingType.SERVICE_REQUEST],
        Service.Type.CONCIERGE: [OfferingType.SERVICE_REQUEST],
        Service.Type.HOUSEKEEPING: [OfferingType.SERVICE_REQUEST],
        Service.Type.INFO: [OfferingType.INFO],
        Service.Type.CUSTOM: [OfferingType.PRODUCT, OfferingType.SERVICE_REQUEST],
    }
    return [
        {
            "type": value,
            "title": SERVICE_TYPE_LABELS.get(value, {}),
            "bricks": [str(b) for b in BRICKS.get(value, [])],
            "tracker_type": tracker_type_for_service_type(value),
            # Слово видно ещё ПРИ ВЫБОРЕ типа: заводя «спа», человек сразу
            # читает, что наполнять его он будет услугами, а не блюдами.
            "noun": noun_for_service_type(value),
            "default_guest_facing": value != Service.Type.HOUSEKEEPING,
        }
        for value, _label in Service.Type.choices
    ]


@transaction.atomic
def create_service(data: dict) -> Service:
    """
    Завести заведение. Исполнителя под него создаём сами: отель выбирает
    «ресторан», а не «кухня + ресторан» — вторая половина всегда одна и та же,
    и просить её у пользователя значит просить лишнего.
    """
    require_hotel_admin()

    service_type = data.get("type") or Service.Type.CUSTOM
    if service_type not in dict(Service.Type.choices):
        raise ValidationError(f"Неизвестный тип сервиса: {service_type}", field="type")

    public_name = _clean_translations(data.get("public_name"), field="public_name")
    if not public_name:
        raise ValidationError("Заполните название заведения", field="public_name")

    from apps.catalog.services.cms import make_code

    code = data.get("code") or make_code(Service, public_name, prefix="service")
    if Service.all_objects.filter(code=code).exists():
        raise ConflictError(f"Сервис «{code}» уже существует", code="service_exists")

    kind = SERVICE_TYPE_TO_KIND.get(service_type, ExecutionPoint.Kind.OTHER)
    point_code = code if not ExecutionPoint.all_objects.filter(code=code).exists() else f"{code}-ep"
    point = ExecutionPoint.objects.create(
        code=point_code,
        # Служебное имя бригады = гостевое имя заведения, пока отель не задал
        # своё: безымянный отдел в эскалациях и на трекере читается как ошибка.
        title=dict(public_name),
        kind=kind,
        sla_minutes=data.get("sla_minutes") or DEFAULT_SLA.get(kind, 20),
        is_active=True,
    )
    return Service.objects.create(
        execution_point=point,
        code=code,
        type=service_type,
        public_name=public_name,
        tagline=_clean_translations(data.get("tagline"), field="tagline"),
        is_guest_facing=data.get(
            "is_guest_facing", service_type != Service.Type.HOUSEKEEPING
        ),
        schedule=_resolve_schedule(data.get("schedule_id")),
        image=_resolve_asset(data.get("image_id")),
        is_active=data.get("is_active", True),
        sort_order=data.get("sort_order") or 0,
    )


# Поля заведения, которые меняет ТОЛЬКО администратор отеля: они двигают тип
# трекера, место на витрине и само существование отдела.
HOTEL_LEVEL_SERVICE_FIELDS = frozenset({"code", "type", "is_active"})

SERVICE_COMMERCE_FIELDS = (
    "service_fee_bp",
    "tip_presets",
    "min_order_minor",
    "free_delivery_threshold_minor",
    "price_round_to_minor",
)


@transaction.atomic
def update_service(service_id, data: dict) -> Service:
    """
    Админ отеля меняет что угодно; управляющий — только своё заведение и только
    его наполнение: идентичность, расписание, обложку, SLA и свою коммерцию.
    """
    # get_service сам проверяет область — второй раз спрашивать нечего;
    # у него же берём права, чтобы отсечь поля уровня отеля.
    service = get_service(service_id)
    access = current_access()
    if not access.unrestricted:
        forbidden = sorted(HOTEL_LEVEL_SERVICE_FIELDS & set(data))
        if forbidden:
            raise HotelAdminOnly(
                "Эти поля заведения меняет администратор отеля: " + ", ".join(forbidden)
            )

    point = service.execution_point

    if "public_name" in data:
        public_name = _clean_translations(data["public_name"], field="public_name")
        if not public_name:
            raise ValidationError("Заполните название заведения", field="public_name")
        service.public_name = public_name
        # Служебное имя бригады едет за гостевым. Пока связь 1:1, отдельного
        # имени у исполнителя нет и быть не может: заводится оно копией с
        # гостевого (см. create_service), а редактора у него нет ни одного.
        # Без этой строки переименование разводило витрину и всё остальное:
        # гость видел новое имя, а трекер, эскалации, привязки каналов, слоты
        # и аналитика — старое, и разъезд не лечился ничем, кроме SQL.
        point.title = dict(public_name)
    if "tagline" in data:
        service.tagline = _clean_translations(data["tagline"], field="tagline")
    if "is_guest_facing" in data and data["is_guest_facing"] is not None:
        service.is_guest_facing = data["is_guest_facing"]
    if "schedule_id" in data:
        service.schedule = _resolve_schedule(data["schedule_id"])
    if "image_id" in data:
        service.image = _resolve_asset(data["image_id"])
    if "sort_order" in data and data["sort_order"] is not None:
        service.sort_order = data["sort_order"]
    if "type" in data and data["type"]:
        if data["type"] not in dict(Service.Type.choices):
            raise ValidationError(f"Неизвестный тип сервиса: {data['type']}", field="type")
        service.type = data["type"]
        # Тип решает и род бригады, и вид трекера — держим их вместе.
        point.kind = SERVICE_TYPE_TO_KIND.get(data["type"], ExecutionPoint.Kind.OTHER)
    if "is_active" in data and data["is_active"] is not None:
        service.is_active = data["is_active"]
        point.is_active = data["is_active"]
    if "sla_minutes" in data and data["sla_minutes"] is not None:
        point.sla_minutes = data["sla_minutes"]

    for field in SERVICE_COMMERCE_FIELDS:
        if field in data:
            setattr(service, field, _validate_service_commerce(field, data[field]))

    point.save()
    service.save()
    return get_service(service_id)


def _validate_service_commerce(field: str, value):
    """Переопределение коммерции сервиса: либо null (наследовать), либо число."""
    if value is None:
        return None
    if field == "tip_presets":
        if not isinstance(value, list) or any(
            not isinstance(x, int) or isinstance(x, bool) or x < 0 or x > 100 for x in value
        ):
            raise ValidationError("Пресеты чаевых — целые проценты от 0 до 100", field=field)
        return list(dict.fromkeys(value))
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ValidationError("Ожидается неотрицательное целое", field=field)
    if field == "service_fee_bp" and value > 10_000:
        raise ValidationError("Сбор не может превышать 100%", field=field)
    return value


@transaction.atomic
def delete_service(service_id) -> None:
    require_hotel_admin()
    from apps.orders.models import Order

    service = get_service(service_id)
    point = service.execution_point
    # Заказы ссылаются на точку через PROTECT — удаление осиротило бы историю.
    if Order.all_objects.filter(execution_point=point).exists():
        raise ConflictError(
            "У заведения есть заказы — его можно только выключить",
            code="service_has_orders",
        )
    service.delete()
    point.delete()
