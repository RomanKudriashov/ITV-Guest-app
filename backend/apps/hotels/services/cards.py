"""
ВСПЛЫВАЮЩИЕ КАРТОЧКИ СУЩНОСТЕЙ (партия 59а): заказ, номер, заведение.

Наведение на имя (ПК) или нажатие (телефон) открывает ОДНУ И ТУ ЖЕ карточку
этого типа на любом экране CMS и трекера. Карточка — «главное за секунду»:
имя, статус, 2–3 факта, одно действие. Подробности — на странице сущности.

ЛЁГКИЕ РУЧКИ, А НЕ ПОВТОР ЭКРАННЫХ. Одиночные ручки экранов (заказ трекера с
журналом и потоком, сервис CMS с шестью агрегатами, сетка номеров) для карточки
тяжелы: наведение мышью по списку — это десятки запросов подряд. Бюджет
карточки — не больше 4 запросов к базе, и его держит тест
(`tests/hotels/test_cards.py`).

ПРАВА — ТЕ ЖЕ, ЧТО У ЭКРАНОВ, И ПРОВЕРЯЮТСЯ ЗДЕСЬ, А НЕ НА КЛИЕНТЕ:

* заказ — ранг на ЕГО точке, как у трекера (`tracker.require_right`); кнопки
  карточки — по `rights` зрителя (`tracker.with_viewer`);
* заведение — администратор отеля видит любое, остальные — только точки своих
  назначений; чужое — 403, карточка пишет «нет доступа»;
* номер — виден всему персоналу, но счёт открытых заказов и задач — только по
  своим точкам. ПЕРСОНАЛЬНЫХ ДАННЫХ ГОСТЯ В КАРТОЧКЕ НЕТ НИ У КОГО: ни имени,
  ни языка, ни истории — только «есть ли сейчас сессия гостя в номере».

RLS — как везде: ручка работает в контексте отеля, и чужой id даёт 404, а не
чужие данные.

ЗАНЯТОСТИ НЕТ. Номерной фонд честно отвечает `occupancy: unknown` до PMS
(`rooms_grid`), и карточка её не выдумывает: «гость на связи» — это живая
гостевая сессия в номере, а не «номер занят».

РЕЕСТР ПОЛЕЙ (`CARD_FIELDS`) — правило «новое поле сущности → в её карточку».
Каждое поле экранного сериализатора типа либо показано в карточке, либо
исключено с причиной. Сторож (`test_cards.py`) краснеет на поле, которого нет
ни там, ни там: новое поле не проходит мимо карточки молча.
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

from django.db.models import Count, Exists, OuterRef, Q, Subquery
from django.utils import timezone

from apps.core.errors import NotFoundError, PermissionDenied
from apps.core.fields import translate

# --- Реестр полей: сторож «новое поле → в карточку» -------------------------
#
# Ключ — поле экранного сериализатора типа (то, что видит экран сущности).
# `shown` — куда в карточке оно попало; `excluded` — почему не попало.

CARD_FIELDS: dict[str, dict[str, dict[str, str]]] = {
    "order": {
        "source": {"serializer": "apps.orders.services.tracker.serialize_tracker_order"},
        "shown": {
            "id": "ссылка «В трекере»",
            "number": "имя «№ N → номер R»",
            "room": "имя «№ N → номер R»",
            "location": "подзаголовок: куда (место выдачи)",
            "delivery_mode": "подзаголовок: в номер / выдача",
            "status": "плашка статуса и шкала этапов",
            "status_flow": "шкала этапов",
            "items": "состав одной строкой",
            "total": "сумма",
            "currency": "сумма",
            "execution_point": "подзаголовок: заведение",
            "assignee": "исполнитель аватаром",
            "due_in_minutes": "обратный отсчёт",
            "is_overdue": "обратный отсчёт красным",
            "overdue_minutes": "«+N мин» просрочки",
            "next_statuses": "главное действие (следующий статус)",
            "rights": "главное действие — по правам зрителя",
            "created_at": "срок «до HH:MM» (от начала работы)",
            "requested_time": "срок «до HH:MM» (время гостя)",
            "type": "состав: заявка или корзина",
        },
        "excluded": {
            "journal": "история переходов — на странице заказа, не за секунду",
            "history": "история гостя — на странице заказа",
            "waiting_minutes": "в карточке отсчёт до срока, ожидание — на доске",
            "accepted_at": "время принятия — на странице заказа",
            "assigned_to_me": "для доски («вам назначено»), в карточке есть исполнитель",
            "can_cancel": "отмена — действие страницы, не карточки",
            "cancel_reason": "причина отмены — на странице заказа",
            "cancel_reason_title": "причина отмены — на странице заказа",
            "source_order": "связь с исходным заказом — на странице",
            "placed_by": "кто оформил за гостя — на странице",
            "errand": "поручение — на странице",
            "comment": "комментарий гостя — на странице (в карточке не за секунду)",
            "charges": "разбивка суммы — на странице",
            "subtotal": "разбивка суммы — на странице",
            "field_values": "ответы формы — на странице",
            "slot": "бронь — на странице",
            "review": "отзыв — на странице",
            "parts": "части составного заказа — на странице",
            "card_kind": "вид карточки доски, а не данные заказа",
            "location_refinement": "уточнение места — на странице",
            "placed_by_label": "подпись «оформил» — на странице",
            "transfer": "перенос — на странице",
            "rejection": "отказ — на странице",
            "updated_at": "служебное",
            "guest_language": "данные гостя в карточку не идут",
            "eta_minutes": "в карточке — срок по норме точки, а не оценка гостю",
            "serve_by": "в карточке — срок по норме точки",
            "allows_guest_cancel": "право гостя, персоналу в карточке не нужно",
            "can_review": "право гостя оставить отзыв — не персоналу",
            "placed_by_staff": "кто оформил за гостя — на странице заказа",
        },
    },
    "room": {
        "source": {"serializer": "apps.hotels.services.admin_services.serialize_room"},
        "shown": {
            "id": "ссылка «Открыть» (номерной фонд)",
            "number": "имя крупно",
            "floor": "подзаголовок: этаж",
            "building": "подзаголовок: корпус",
            "category": "подзаголовок: тип номера",
            "housekeeping": "значок «убран / не убран»",
            "out_of_service": "плашка «вне продажи»",
            "is_active": "плашка «выключен»",
            "control_type": "значок «управление на связи»",
        },
        "excluded": {
            "zone": "историческая строка корпуса, есть `building`",
            "building_id": "есть `building`",
            "category_id": "есть `category`",
            "source": "откуда заведён номер — служебное",
            "guest_url": "ссылка гостя с QR — не для карточки персонала",
            "restored": "событие правки, а не состояние номера",
            "restored_orders": "событие правки, а не состояние номера",
            "restored_sessions": "событие правки, а не состояние номера",
            "revoked_sessions": "событие правки, а не состояние номера",
        },
    },
    "venue": {
        "source": {"serializer": "apps.hotels.services.admin_services.serialize_service"},
        "shown": {
            "id": "ссылка «Открыть» (сервис)",
            "code": "ссылка трекера точки",
            "type": "подзаголовок: вид заведения",
            "public_name": "имя",
            "image": "фото полосой",
            "is_active": "плашка «выключено»",
            "schedule_id": "«Открыто до / Откроется в»",
            "execution_point": "«в работе · просрочено» по точке и ссылка трекера",
            "item_count": "подзаголовок: N позиций",
        },
        "excluded": {
            "tagline": "подпись гостю — на витрине, не в карточке персонала",
            "is_guest_facing": "настройка показа — на странице сервиса",
            "has_catalog": "настройка — на странице сервиса",
            "sort_order": "порядок на витрине — служебное",
            "tracker_type": "вид доски — видно по ссылке трекера",
            "noun": "слово каталога — на странице сервиса",
            "menu_view": "вид меню гостя — на странице сервиса",
            "menu_view_available": "вид меню гостя — на странице сервиса",
            "commerce": "коммерция — на странице сервиса",
            "category_count": "в карточке — позиции, разделы на странице",
            "staff_count": "персонал — на странице сервиса",
            "channel_count": "каналы — на странице уведомлений",
            "inclusion_count": "включения — на странице сервиса",
            "has_escalation": "эскалация — на странице уведомлений",
        },
    },
}


# --- Права зрителя: ОДНИМ запросом ------------------------------------------


class _Viewer:
    """Ранг зрителя по точкам — одним запросом, а не `rank_on` на каждую."""

    def __init__(self, user):
        from apps.accounts.models import StaffAssignment
        from apps.orders.services import tracker

        self.user = user
        self.id = str(user.pk) if user is not None else None
        # Администратор видит все точки (`tracker.sees_every_point` — тот же
        # признак учётки), и назначения ему не нужны: запрос не тратится.
        self.unrestricted = _is_admin(user)
        self.ranks: dict[str, int] = {}
        if not self.unrestricted and user is not None:
            for point_id, level in StaffAssignment.objects.filter(user=user, is_active=True).values_list(
                "execution_point_id", "level"
            ):
                rank = tracker._RANK.get(level, 0)
                key = str(point_id)
                self.ranks[key] = max(self.ranks.get(key, 0), rank)

    def rank(self, point_id) -> int:
        from apps.orders.services import tracker

        if self.unrestricted:
            return tracker.ADMIN_RANK
        return self.ranks.get(str(point_id), 0)

    @property
    def point_ids(self) -> list[str]:
        return list(self.ranks)


def _is_admin(user) -> bool:
    # Без запроса: признак лежит на учётке. Иначе `sees_every_point` спрашивал
    # бы назначения у каждого, а они нужны только не-администратору.
    return bool(getattr(user, "is_hotel_admin", False) or getattr(user, "is_platform_admin", False))


def _uuid(value: str) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        return None


# --- Заказ --------------------------------------------------------------------


def order_card(user, order_id: str, language: str | None = None) -> dict[str, Any]:
    from django.db.models import Prefetch

    from apps.hotels.models import Service
    from apps.orders.models import Order
    from apps.orders.services import status_flows, tracker
    from apps.orders.services.tracker_types import effective_sla_minutes, work_clock_start

    key = _uuid(order_id)
    if key is None:
        raise NotFoundError("Заказ не найден")
    viewer = _Viewer(user)
    order = (
        Order.objects.select_related("status", "execution_point", "assignee", "room", "location", "hotel")
        # Тип сервиса точки — подзапросом в том же запросе: он нужен норме
        # времени (`effective_sla_minutes` → `_service_of`), и отдельный запрос
        # на сервис вывел бы карточку за бюджет.
        .annotate(
            _service_type=Subquery(
                Service.objects.filter(execution_point_id=OuterRef("execution_point_id"))
                .order_by("sort_order", "code")
                .values("type")[:1]
            )
        )
        .prefetch_related(Prefetch("items"))
        .filter(pk=key)
        .first()
    )
    if order is None:
        raise NotFoundError("Заказ не найден")
    point = order.execution_point
    # Язык отеля — фолбэк перевода — уже приехал с заказом: без него каждый
    # `translate` спросил бы его отдельным запросом (бюджет карточки).
    fb = order.hotel.default_language
    rank = viewer.rank(point.pk)
    tracker.require_right(user, tracker.Action.READ, point, rank=rank)

    # Предвыборка сервиса точки для единого правила нормы времени — тот же
    # кэш, который читает `_service_of` (см. `tracker_types`).
    point._prefetched_objects_cache = {
        "services": [Service(type=order._service_type)] if order._service_type else []
    }

    statuses = status_flows.statuses_for_flow(order.status.flow)
    now = timezone.now()
    terminal = order.status.is_terminal
    sla = effective_sla_minutes(point)
    due_at = work_clock_start(order) + timedelta(minutes=sla)
    due_in = None if terminal else int((due_at - now).total_seconds() // 60)

    lines = list(order.items.all())
    nexts = [
        {"code": s.code, "title": status_flows.status_title(s, order.delivery_mode, language)}
        for s in tracker.next_statuses(order, statuses)
    ]
    card = {
        "type": "order",
        "id": str(order.pk),
        "number": order.number,
        "room": order.room.number if order.room_id else None,
        "location": translate(order.location.title, language, fallback_language=fb) if order.location_id else None,
        "delivery_mode": order.delivery_mode,
        "venue": {
            "id": str(point.pk),
            "code": point.code,
            "title": translate(point.title, language, fallback_language=fb) or point.code,
        },
        "status": {
            "code": order.status.code,
            "title": status_flows.status_title(order.status, order.delivery_mode, language),
            "color_token": order.status.color_token,
            "is_terminal": terminal,
            "is_cancelled": order.status.is_cancelled,
        },
        # Шкала этапов — путь потока без отмены, текущий отмечен.
        "stages": [
            {
                "code": s.code,
                "title": status_flows.status_title(s, order.delivery_mode, language),
                "current": s.pk == order.status_id,
            }
            for s in statuses
            if not s.is_cancelled
        ],
        "due_at": order.hotel.to_local(due_at).strftime("%H:%M"),
        # Минуты до срока; отрицательные — просрочен на столько. У закрытого — нет.
        "due_in_minutes": due_in,
        "lines": [
            {"title": translate(line.title_snapshot, language, fallback_language=fb), "quantity": line.quantity}
            for line in lines[:3]
        ],
        "lines_more": max(len(lines) - 3, 0),
        "total": order.total,
        "currency": order.currency,
        "assignee": (
            {"id": str(order.assignee_id), "name": order.assignee.full_name or order.assignee.email}
            if order.assignee_id
            else None
        ),
        "accepted_at": order.accepted_at.isoformat() if order.accepted_at else None,
        "next_statuses": nexts,
    }
    # Права ЗРИТЕЛЯ — тем же правилом, что у карточки доски.
    tracker.with_viewer(card, rank, viewer.id)
    card.pop("assigned_to_me", None)
    card.pop("accepted_at", None)
    card.pop("can_cancel", None)
    return card


# --- Номер --------------------------------------------------------------------


def room_card(user, room_key: str, language: str | None = None) -> dict[str, Any]:
    from apps.accounts.models import GuestSession
    from apps.hotels.models import Room
    from apps.hotels.services.admin_services import _device_state
    from apps.orders.models import Order

    viewer = _Viewer(user)
    key = _uuid(room_key)
    lookup = Q(pk=key) if key is not None else Q(number=str(room_key))

    # Открытые заказы и задачи — ТОЛЬКО по точкам зрителя (кроме администратора).
    mine = Q(status__is_terminal=False, room_id=OuterRef("pk"), children__isnull=True)
    if not viewer.unrestricted:
        mine &= Q(execution_point_id__in=viewer.point_ids)
    open_orders = (
        Order.objects.filter(mine, source_thread__isnull=True)
        .order_by()
        .values("room_id")
        .annotate(n=Count("pk"))
        .values("n")
    )
    open_tasks = (
        Order.objects.filter(mine, source_thread__isnull=False)
        .order_by()
        .values("room_id")
        .annotate(n=Count("pk"))
        .values("n")
    )
    now = timezone.now()
    session = GuestSession.objects.filter(
        room_id=OuterRef("pk"), revoked_at__isnull=True, expires_at__gt=now
    )
    annotations: dict[str, Any] = {
        "_open_orders": Subquery(open_orders[:1]),
        "_open_tasks": Subquery(open_tasks[:1]),
        "_guest_online": Exists(session),
    }
    try:
        from apps.grms.models import RoomTypeRoom

        annotations["_control_type"] = Subquery(
            RoomTypeRoom.objects.filter(room_id=OuterRef("pk")).values("room_type__code")[:1]
        )
    except ImportError:  # pragma: no cover — модуль GRMS не собран
        pass

    room = (
        Room.objects.select_related("category", "building", "hotel")
        .annotate(**annotations)
        .filter(lookup)
        .first()
    )
    if room is None:
        raise NotFoundError("Номер не найден")

    fb = room.hotel.default_language
    control_type = getattr(room, "_control_type", None)
    return {
        "type": "room",
        "id": str(room.pk),
        "number": room.number,
        "floor": room.floor or None,
        "building": translate(room.building.title, language, fallback_language=fb) if room.building_id else None,
        "category": translate(room.category.title, language, fallback_language=fb) if room.category_id else None,
        "is_active": room.is_active,
        "out_of_service": room.out_of_service,
        "housekeeping": room.housekeeping,
        # Живая гостевая сессия в номере — без имени, языка и истории.
        "guest_online": bool(room._guest_online),
        "open_orders": room._open_orders or 0,
        "open_tasks": room._open_tasks or 0,
        # Связь управления — по узлу (как у сетки): `None` — номер не управляется.
        "control": _device_state() if control_type else None,
    }


# --- Заведение ----------------------------------------------------------------


def venue_card(user, venue_key: str, language: str | None = None) -> dict[str, Any]:
    from apps.catalog.models import Item
    from apps.catalog.services.showcase import _service_status
    from apps.hotels.models import Service
    from apps.media.services import image_url
    from apps.orders.models import Order
    from apps.orders.services.tracker_types import effective_sla_minutes, work_clock_start

    viewer = _Viewer(user)
    key = _uuid(venue_key)
    # Ключ — id сервиса или его точки (трекер знает точку, CMS — сервис), либо
    # код того или другого.
    lookup = (
        Q(pk=key) | Q(execution_point_id=key)
        if key is not None
        else Q(code=str(venue_key)) | Q(execution_point__code=str(venue_key))
    )
    items = (
        Item.objects.filter(
            is_active=True,
            category__is_active=True,
            category__routes__is_active=True,
            category__routes__execution_point_id=OuterRef("execution_point_id"),
        )
        .order_by()
        .values("category__routes__execution_point_id")
        .annotate(n=Count("pk", distinct=True))
        .values("n")
    )
    service = (
        Service.objects.select_related("execution_point", "image", "schedule", "schedule__hotel", "hotel")
        .prefetch_related("schedule__intervals")
        .annotate(_items=Subquery(items[:1]))
        .filter(lookup)
        .order_by("sort_order", "code")
        .first()
    )
    if service is None:
        raise NotFoundError("Заведение не найдено")
    point = service.execution_point
    fb = service.hotel.default_language
    if viewer.rank(point.pk) == 0:
        raise PermissionDenied("Нет доступа к этому заведению", code="card_no_access")

    # Норма времени — по тому же правилу, что у доски; сервис уже есть.
    point._prefetched_objects_cache = {"services": [service]}
    sla = timedelta(minutes=effective_sla_minutes(point))
    now = timezone.now()
    in_work = overdue = 0
    for order in Order.objects.filter(
        execution_point=point, status__is_terminal=False, children__isnull=True
    ).only("created_at", "requested_time", "reopened_at", "transferred_at"):
        in_work += 1
        if now - work_clock_start(order) >= sla:
            overdue += 1

    status = _service_status(service, now) if service.schedule_id else None
    return {
        "type": "venue",
        "id": str(service.pk),
        "point_code": point.code,
        "title": translate(service.public_name, language, fallback_language=fb) or translate(point.title, language, fallback_language=fb) or service.code,
        "kind": service.type,
        "is_active": service.is_active,
        "image": (image_url(service.image, variant="thumb") or service.image.url("card")) if service.image_id else None,
        "items": service._items or 0,
        # `null` — расписания нет, заведение «всегда».
        "schedule": status,
        "in_work": in_work,
        "overdue": overdue,
    }


CARDS = {"order": order_card, "room": room_card, "venue": venue_card}


def card(user, card_type: str, key: str, language: str | None = None) -> dict[str, Any]:
    builder = CARDS.get(card_type)
    if builder is None:
        raise NotFoundError("Нет такой карточки")
    return builder(user, key, language)
