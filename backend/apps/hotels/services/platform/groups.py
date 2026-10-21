"""
Группы отелей: отели одного владельца (партия 62-A1).

ОДНО МЕСТО НА СОСТАВ. Фильтр «Отелей», массовое действие, публикация и область
сотрудника зовут `queryset()` / `hotel_ids()`. Второе место, где состав
собирается по-своему, разошлось бы с первым молча.

ОТЕЛЬ — МАКСИМУМ В ОДНОЙ ГРУППЕ. Добавить отель в группу значит ПЕРЕНЕСТИ его:
из прежней группы он уходит сам. Уникальность держит и база
(`uniq_hotel_one_group`), но перенос делается здесь, одной транзакцией, —
иначе человек получал бы ошибку базы вместо переезда.

ГРУПП-ПРАВИЛ БОЛЬШЕ НЕТ: состав складывают руками (решение Олега, партия 62).
"""

from __future__ import annotations

import re

from django.db import transaction

from apps.hotels.models import Hotel, HotelGroup, HotelGroupMember


def queryset(group: HotelGroup):
    """Отели группы."""
    return Hotel.objects.filter(group_links__group=group, group_links__deleted_at__isnull=True).distinct()


def hotel_ids(group: HotelGroup) -> list:
    return list(queryset(group).values_list("pk", flat=True))


def group_by_hotel(hotel_ids_: list) -> dict:
    """Отель → его группа, одним запросом (для реестра)."""
    rows = HotelGroupMember.objects.filter(hotel_id__in=hotel_ids_, group__deleted_at__isnull=True).select_related("group")
    return {row.hotel_id: row.group for row in rows}


# --- Чтение -----------------------------------------------------------------


def get(group_id: str, user=None) -> HotelGroup:
    """
    Группа по id. Выборка живёт в сервисе — вьюха её зовёт (сторож `check_views`).

    Вне области — 404, а не отказ: подтверждать существование чужой группы мы
    не обязаны (см. `scope.assert_allows`).
    """
    from apps.core.errors import NotFoundError

    group = HotelGroup.objects.filter(pk=group_id).first()
    if group is None:
        raise NotFoundError("Группа не найдена")

    from apps.hotels.services.platform import scope

    ids = {str(gid) for gid in scope.group_ids(user)}
    if ids and str(group.pk) not in ids:
        raise NotFoundError("Группа не найдена")
    return group


def find(group_id: str) -> HotelGroup | None:
    """Группа или None — там, где отсутствие не ошибка (фильтр реестра)."""
    return HotelGroup.objects.filter(pk=group_id).first()


def all_groups(user=None):
    """
    Группы, которые человеку положено видеть. Ограниченный областью видит
    ТОЛЬКО свои: список чужих групп — это карта наших клиентов.
    """
    from apps.hotels.services.platform import scope

    ids = scope.group_ids(user)
    queryset_ = HotelGroup.objects.all()
    return queryset_.filter(pk__in=ids) if ids else queryset_


# --- Заведение и правка -----------------------------------------------------

_TRANSLIT = dict(
    zip(
        "абвгдеёжзийклмнопрстуфхцчшщъыьэюя",
        ["a", "b", "v", "g", "d", "e", "e", "zh", "z", "i", "y", "k", "l", "m", "n", "o", "p", "r", "s", "t",
         "u", "f", "h", "ts", "ch", "sh", "sch", "", "y", "", "e", "yu", "ya"],
    )
)


def _code_for(title: str) -> str:
    """Внутренний код из названия: человек его не вводит и не видит."""
    base = "".join(_TRANSLIT.get(ch, ch) for ch in title.lower())
    base = re.sub(r"[^a-z0-9]+", "-", base).strip("-")[:48] or "group"
    code, n = base, 1
    while HotelGroup.all_objects.filter(code=code).exists():
        n += 1
        code = f"{base}-{n}"
    return code


def _clean_color(value) -> str:
    from apps.core.errors import ValidationError

    color = (value or HotelGroup.Color.ACCENT).strip()
    if color not in HotelGroup.Color.values:
        raise ValidationError("Такого цвета метки нет", field="color", code="group_color")
    return color


def _clean_parent(group: HotelGroup | None, parent_id):
    from apps.core.errors import ValidationError

    if not parent_id:
        return None
    parent = HotelGroup.objects.filter(pk=parent_id).first()
    if parent is None:
        raise ValidationError("Родительской группы нет", field="parent_id", code="group_parent")
    if group is not None and (parent.pk == group.pk or parent.parent_id == group.pk):
        raise ValidationError("Группа не может входить сама в себя", field="parent_id", code="group_parent_loop")
    return parent


def create(data: dict, *, actor_id=None) -> HotelGroup:
    """
    Завести группу — сразу с отелями, если их выбрали.

    НАЗВАНИЕ ОБЯЗАТЕЛЬНО и проверяется ЗДЕСЬ: пустое название доезжало бы до
    базы пятисоткой вместо внятного «заполните название».
    """
    from apps.core.errors import ValidationError

    title = (data.get("title") or "").strip()
    if not title:
        raise ValidationError("Назовите группу", field="title", code="title_required")
    if HotelGroup.objects.filter(title__iexact=title).exists():
        raise ValidationError(f"Группа «{title}» уже есть", field="title", code="title_taken")
    code = (data.get("code") or "").strip() or _code_for(title)
    if HotelGroup.objects.filter(code=code).exists():
        raise ValidationError(f"Код «{code}» уже занят", field="code", code="code_taken")
    # Код мог занять группа, удалённая МЯГКО: группе-метке помнить нечего.
    HotelGroup.all_objects.filter(code=code, deleted_at__isnull=False).hard_delete()

    last = HotelGroup.objects.order_by("-sort_order").values_list("sort_order", flat=True).first() or 0
    with transaction.atomic():
        group = HotelGroup.objects.create(
            code=code,
            title=title,
            description=(data.get("description") or "").strip(),
            note=(data.get("note") or "").strip(),
            color=_clean_color(data.get("color")),
            sort_order=data.get("sort_order") or last + 1,
            parent=_clean_parent(None, data.get("parent_id")),
        )
        if data.get("hotel_ids"):
            move(list(data["hotel_ids"]), group, actor_id=actor_id)
    return group


def update(group: HotelGroup, data: dict) -> dict:
    """Правка группы. Возвращает «было → стало» по изменённым полям — для журнала."""
    from apps.core.errors import ValidationError

    changes: dict[str, dict] = {}

    def put(field: str, value):
        before = getattr(group, field)
        if before != value:
            changes[field] = {"from": before, "to": value}
            setattr(group, field, value)

    if data.get("title") is not None:
        title = data["title"].strip()
        if not title:
            raise ValidationError("Назовите группу", field="title", code="title_required")
        if HotelGroup.objects.filter(title__iexact=title).exclude(pk=group.pk).exists():
            raise ValidationError(f"Группа «{title}» уже есть", field="title", code="title_taken")
        put("title", title)
    for field in ("description", "note"):
        if data.get(field) is not None:
            put(field, data[field].strip())
    if data.get("color") is not None:
        put("color", _clean_color(data["color"]))
    if data.get("sort_order") is not None:
        put("sort_order", int(data["sort_order"]))
    if "parent_id" in data:
        parent = _clean_parent(group, data["parent_id"])
        if group.parent_id != (parent.pk if parent else None):
            changes["parent"] = {"from": str(group.parent_id or ""), "to": str(parent.pk) if parent else ""}
            group.parent = parent
    if changes:
        group.save()
    return changes


def delete(group: HotelGroup, confirm_title: str) -> list[str]:
    """
    Удалить группу. ОТЕЛИ НЕ ТРОГАЕМ: они уходят в «без группы».

    Подтверждение — названием группы: удаление нельзя сделать случайным
    кликом, и человек видит, что именно удаляет. Возвращает поддомены отелей,
    которые остались без группы, — для журнала.

    Группа-область сотрудника не удаляется (партия 59а): строки области ушли
    бы каскадом, а «строк нет» значит «ограничения нет».
    """
    from apps.core.errors import ConflictError, ValidationError

    holders = group.scoped_users.count()
    if holders:
        raise ConflictError(
            f"Группа ограничивает доступ {holders} сотрудник(ов) платформы — сначала снимите это ограничение",
            code="group_is_scope",
        )
    if (confirm_title or "").strip() != group.title:
        raise ValidationError("Введите название группы точно", field="confirm_title", code="group_confirm")
    released = list(queryset(group).values_list("subdomain", flat=True))
    with transaction.atomic():
        HotelGroupMember.all_objects.filter(group=group).hard_delete()
        HotelGroup.objects.filter(parent=group).update(parent=None)
        group.delete(hard=True)
    return released


# --- Состав ------------------------------------------------------------------


def move(hotel_ids_: list[str], group: HotelGroup | None, *, actor_id=None) -> list[dict]:
    """
    Перенести отели в группу (или убрать из группы — `group=None`).

    Возвращает переезды «отель: было → стало» — только тех, у кого группа
    действительно сменилась: журнал и ответ считают перемены, а не галочки.
    """
    hotels = list(Hotel.objects.filter(pk__in=hotel_ids_))
    current = group_by_hotel([hotel.pk for hotel in hotels])
    moves = []
    with transaction.atomic():
        for hotel in hotels:
            before = current.get(hotel.pk)
            if (before.pk if before else None) == (group.pk if group else None):
                continue
            # Жёстко: у членства нет истории (она — в журнале), а мягко снятая
            # строка держала бы уникальность пары.
            HotelGroupMember.all_objects.filter(hotel=hotel).hard_delete()
            if group is not None:
                HotelGroupMember.objects.create(group=group, hotel=hotel, added_by=actor_id)
            moves.append(
                {
                    "hotel": hotel.subdomain,
                    "from": before.title if before else "",
                    "to": group.title if group else "",
                }
            )
    return moves


def add_members(group: HotelGroup, hotel_ids_: list[str], *, actor_id=None) -> int:
    """Положить отели в группу (переносом). Возвращает число переехавших."""
    return len(move(hotel_ids_, group, actor_id=actor_id))


def remove_member(group: HotelGroup, hotel_id: str) -> int:
    deleted, _ = HotelGroupMember.all_objects.filter(group=group, hotel_id=hotel_id).hard_delete()
    return deleted


# --- Выдача -----------------------------------------------------------------


def serialize(group: HotelGroup, *, with_size: bool = True) -> dict:
    data = {
        "id": str(group.pk),
        "code": group.code,
        "title": group.title,
        "description": group.description,
        "note": group.note,
        "color": group.color,
        "sort_order": group.sort_order,
        "parent_id": str(group.parent_id) if group.parent_id else None,
        "created_at": group.created_at.isoformat(),
    }
    if with_size:
        data["size"] = queryset(group).count()
    return data


def members(group: HotelGroup) -> list[dict]:
    """Состав с ответом на «кто и когда добавил»."""
    rows = HotelGroupMember.objects.filter(group=group).select_related("hotel").order_by("-created_at")
    actors = _actor_names([row.added_by for row in rows if row.added_by])
    return [
        {
            "hotel_id": str(row.hotel_id),
            "name": row.hotel.name_i18n,
            "subdomain": row.hotel.subdomain,
            "is_active": row.hotel.is_active,
            "added_by": actors.get(row.added_by),
            "added_at": row.created_at.isoformat(),
        }
        for row in rows
    ]


def _actor_names(ids: list) -> dict:
    """Имена наших операторов: `added_by` — UUID, человеку он не говорит ничего."""
    from apps.accounts.models import User
    from apps.core.context import platform_scope

    if not ids:
        return {}
    with platform_scope():
        return {
            user.pk: user.full_name or user.email
            for user in User.all_objects.using("platform").filter(pk__in=set(ids))
        }


def groups_of(hotel: Hotel) -> list[dict]:
    """Группа отеля (список из одной или пустой) — для карточки отеля."""
    group = group_by_hotel([hotel.pk]).get(hotel.pk)
    return [serialize(group, with_size=False)] if group else []
