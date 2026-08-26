"""
Состав группы: одно место, где правило превращается в список отелей.

ПРАВИЛО ПЕРЕСЧИТЫВАЕТСЯ, А НЕ ПОМНИТСЯ. Группа-правило не хранит состав вовсе:
`queryset()` строит его в момент вопроса. Заведённый вчера московский отель
попадает под «город Москва» сам, а переехавший в другой город — выпадает.
Хранимый состав у правила был бы списком, притворяющимся правилом: человек
пересобирал бы его руками и однажды забыл.

ОДНА ФУНКЦИЯ НА ВСЕХ СПРАШИВАЮЩИХ. Фильтр флота, массовое действие, экран
состава и будущая публикация зовут `queryset()`. Второе место, где правило
разбирается по полям, разошлось бы с первым молча — и «применилось к 47» на
предпросмотре не совпало бы с тем, к скольким применилось на самом деле.
"""

from __future__ import annotations

from django.db.models import Q, TextField
from django.db.models.functions import Cast

from apps.hotels.models import Hotel, HotelGroup, HotelGroupMember

# Признаки, по которым умеет резать правило. Список ЗАКРЫТ намеренно: правило с
# произвольным полем — это способ уронить выдачу опечаткой в JSON, а сообщить
# об этом будет нечем.
# `country` в модели отеля НЕТ — правило умеет резать только по тому, что
# в базе действительно есть. Признак, которого нет, дал бы правило, всегда
# возвращающее пустоту, и объяснить это человеку было бы нечем.
RULE_FIELDS = ("city", "origin", "tariff", "language")


def queryset(group: HotelGroup):
    """Отели группы. Для правила — вычисленные ПРЯМО СЕЙЧАС."""
    if group.is_rule:
        return _by_rule(group.rule or {})
    return Hotel.objects.filter(group_links__group=group)


def hotel_ids(group: HotelGroup) -> list:
    return list(queryset(group).values_list("pk", flat=True))


def _by_rule(rule: dict):
    """
    Правило → выборка. Пустые ключи не участвуют: правило без условий обязано
    означать «все», а не «никто» — иначе полупустая форма тихо давала бы
    действие в пустоту.
    """
    queryset = Hotel.objects.all()

    origin = (rule.get("origin") or "").strip()
    if origin:
        queryset = queryset.filter(origin=origin)

    tariff = (rule.get("tariff") or "").strip()
    if tariff:
        queryset = queryset.filter(tariff=tariff)

    city = (rule.get("city") or "").strip()
    if city:
        # ГОРОД ПЕРЕВОДИМЫЙ: в базе это JSON `{"ru": "Москва", "en": "Moscow"}`,
        # и под каким ключом лежит нужное название, заранее неизвестно. Ищем по
        # тексту всего значения: «Москва» найдёт и `ru`, и любой другой язык, в
        # котором её так написали. Ключ-за-ключом означало бы гадать про набор
        # языков отеля, а мы его здесь не знаем.
        queryset = queryset.annotate(_city_text=Cast("city", TextField())).filter(
            _city_text__icontains=city
        )

    language = (rule.get("language") or "").strip()
    if language:
        queryset = queryset.filter(default_language=language)

    return queryset


def clean_rule(rule: dict | None) -> dict:
    """Оставить только известные признаки и непустые значения."""
    source = rule or {}
    return {
        key: str(source[key]).strip()
        for key in RULE_FIELDS
        if str(source.get(key) or "").strip()
    }


# --- Заведение и правка -----------------------------------------------------


def get(group_id: str, user=None) -> HotelGroup:
    """
    Группа по id. Выборка живёт в сервисе — вьюха её зовёт (сторож `check_views`).

    Вне области — 404, а не отказ: подтверждать существование чужой сети мы не
    обязаны (см. `scope.assert_allows`).
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
    """Группа или None — там, где отсутствие не ошибка (фильтр флота)."""
    return HotelGroup.objects.filter(pk=group_id).first()


def all_groups(user=None):
    """
    Группы, которые человеку положено видеть.

    Ограниченный областью видит ТОЛЬКО свои: список чужих сетей и кампаний —
    это карта наших клиентов, и показывать её администратору одной сети
    незачем.
    """
    from apps.hotels.services.platform import scope

    ids = scope.group_ids(user)
    queryset = HotelGroup.objects.all()
    return queryset.filter(pk__in=ids) if ids else queryset


def create(data: dict) -> HotelGroup:
    """
    Завести группу.

    КОД И НАЗВАНИЕ ОБЯЗАТЕЛЬНЫ, и проверяются ЗДЕСЬ. В схеме они необязательны,
    потому что та же схема обслуживает частичную правку; без проверки пустой
    `code` доезжал до базы и падал `IntegrityError` — то есть пятисоткой
    «сломалась платформа» вместо внятного «заполните код».
    """
    from apps.core.errors import ValidationError

    code = (data.get("code") or "").strip()
    title = (data.get("title") or "").strip()
    if not code:
        raise ValidationError("У группы должен быть код", field="code", code="code_required")
    if not title:
        raise ValidationError("У группы должно быть название", field="title", code="title_required")
    if HotelGroup.objects.filter(code=code).exists():
        raise ValidationError(f"Группа с кодом «{code}» уже есть", field="code", code="code_taken")

    return HotelGroup.objects.create(
        code=code,
        title=title,
        kind=data.get("kind") or HotelGroup.Kind.CUSTOM,
        mode=data.get("mode") or HotelGroup.Mode.LIST,
        rule=clean_rule(data.get("rule")),
        note=data.get("note") or "",
    )


def update(group: HotelGroup, data: dict) -> HotelGroup:
    for field in ("code", "title", "kind", "mode", "note"):
        if field in data and data[field] is not None:
            setattr(group, field, data[field])
    if "rule" in data:
        group.rule = clean_rule(data["rule"])
    group.save()
    return group


def delete(group: HotelGroup) -> str:
    """
    Удалить группу. ЖЁСТКО: группа — метка, а не данные отеля, и мягко
    удалённая продолжала бы занимать свой уникальный код.
    """
    code = group.code
    group.delete()
    return code


# --- Состав руками ----------------------------------------------------------


def add_members(group: HotelGroup, hotel_ids_: list[str], *, actor_id=None) -> int:
    """
    Положить отели в группу-список. Возвращает число ДОБАВЛЕННЫХ.

    Группе-правилу состав руками не задаётся: её состав — следствие условия, и
    «добавить отель в правило» означало бы либо изменить условие, либо завести
    исключение, о котором потом никто не вспомнит.
    """
    _refuse_rule(group)

    existing = set(
        HotelGroupMember.objects.filter(group=group).values_list("hotel_id", flat=True)
    )
    fresh = [hid for hid in Hotel.objects.filter(pk__in=hotel_ids_).values_list("pk", flat=True)
             if hid not in existing]
    HotelGroupMember.objects.bulk_create(
        [HotelGroupMember(group=group, hotel_id=hid, added_by=actor_id) for hid in fresh]
    )
    return len(fresh)


def remove_member(group: HotelGroup, hotel_id: str) -> int:
    _refuse_rule(group)
    deleted, _ = HotelGroupMember.objects.filter(group=group, hotel_id=hotel_id).delete()
    return deleted


def _refuse_rule(group: HotelGroup) -> None:
    from apps.core.errors import ValidationError

    if group.is_rule:
        raise ValidationError(
            "Состав группы-правила задаётся условием, а не руками",
            field="mode",
            code="group_is_rule",
        )


# --- Выдача -----------------------------------------------------------------


def serialize(group: HotelGroup, *, with_size: bool = True) -> dict:
    data = {
        "id": str(group.pk),
        "code": group.code,
        "title": group.title,
        "kind": group.kind,
        "mode": group.mode,
        "rule": group.rule or {},
        "note": group.note,
        "created_at": group.created_at.isoformat(),
    }
    if with_size:
        # Размер считаем ЗДЕСЬ, а не на экране: у правила он вычисляемый, и
        # клиент, сложивший строки членства, показал бы ноль.
        data["size"] = queryset(group).count()
    return data


def members(group: HotelGroup) -> list[dict]:
    """
    Состав с ответом на «кто и когда добавил».

    У группы-правила этих ответов нет и быть не может: отель попал в неё
    условием, а не человеком. Отдаём пустые поля вместо выдуманного автора —
    экран покажет «по правилу».
    """
    if group.is_rule:
        return [
            {
                "hotel_id": str(hotel.pk),
                "name": hotel.name_i18n,
                "subdomain": hotel.subdomain,
                "is_active": hotel.is_active,
                "added_by": None,
                "added_at": None,
            }
            for hotel in queryset(group).order_by("subdomain")
        ]

    rows = (
        HotelGroupMember.objects.filter(group=group)
        .select_related("hotel")
        .order_by("-created_at")
    )
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
    """
    В каких группах отель. Для карточки отеля в консоли.

    Правила проверяются пересчётом — по той же причине, по которой состав не
    хранится: ответ должен быть сегодняшним.
    """
    result = []
    for group in HotelGroup.objects.all():
        inside = (
            queryset(group).filter(pk=hotel.pk).exists()
            if group.is_rule
            else HotelGroupMember.objects.filter(group=group, hotel=hotel).exists()
        )
        if inside:
            result.append(serialize(group, with_size=False))
    return result
