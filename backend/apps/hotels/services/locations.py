"""
Места получения заказа для гостя — С УЧЁТОМ МАТРИЦЫ.

Матрица «категория × локация» долго была декоративной: её правил экран
настроек, а гостю показывались все локации отеля, и заказ принимался в любую.
Здесь одно правило, и его зовут оба — список мест для гостя и проверка заказа:
иначе гость увидел бы место, куда заказ потом не примут, или наоборот.

ПРАВИЛО. Место доступно для набора категорий, если доступно для КАЖДОЙ:
  * у категории есть связки в матрице — только в отмеченных местах;
  * связок нет вовсе («не настроена») — во всех местах ДОСТАВКИ, но не в
    точках выдачи. Не настроенная категория была заказываемой всегда, и
    закрыть её молча значило бы сломать живой отель новой проверкой (у
    «Кристалла» так жили коктейли бара). А выдачу у стойки отель включает
    сам: заказ кухни не должен внезапно оказаться «заберите у бара».

В НОМЕР — только тому, у кого номер есть: гость по ссылке без комнаты
доставку в номер получить не может.
"""

from __future__ import annotations

from collections.abc import Iterable

from apps.hotels.models import Location


def allowed_locations(category_ids: Iterable, *, has_room: bool) -> list[Location]:
    """Места, где можно получить ВСЕ названные категории. Пусто — любые категории."""
    categories = {str(pk) for pk in category_ids}
    rule = _Rule(categories)
    return [
        location
        for location in Location.objects.filter(is_active=True).order_by("sort_order", "code")
        if (has_room or location.kind != Location.Kind.IN_ROOM) and rule.allows(location)
    ]


def location_allows(location: Location, category_ids: Iterable) -> list[str]:
    """Категории из набора, которых в этом месте нет. Пусто — место подходит."""
    rule = _Rule({str(pk) for pk in category_ids})
    return rule.missing(location)


class _Rule:
    def __init__(self, categories: set[str]):
        from apps.catalog.models import ServiceLocation

        self.categories = categories
        links = ServiceLocation.objects.all()
        if categories:
            links = links.filter(category_id__in=categories)
        rows = list(links.values_list("category_id", "location_id", "is_enabled"))
        self.configured = {str(category) for category, _, _ in rows}
        self.enabled = {(str(category), str(location)) for category, location, on in rows if on}
        self.served = {location for _, location in self.enabled}

    def missing(self, location: Location) -> list[str]:
        return [
            category
            for category in sorted(self.categories)
            if not self._category_allows(category, location)
        ]

    def allows(self, location: Location) -> bool:
        if not self.categories:
            # Без корзины: место доставки — всегда, точка выдачи — если там
            # хоть что-то выдают.
            return not location.is_pickup or str(location.pk) in {str(pk) for pk in self.served}
        return not self.missing(location)

    def _category_allows(self, category: str, location: Location) -> bool:
        if category in self.configured:
            return (category, str(location.pk)) in self.enabled
        return not location.is_pickup


def delivery_mode_of(location: Location | None) -> str:
    """Способ получения следует из вида места: точка выдачи — самовывоз."""
    from apps.orders.models import Order

    if location is not None and location.is_pickup:
        return Order.DeliveryMode.PICKUP
    return Order.DeliveryMode.DELIVERY


def guest_locations(session, language: str, item_ids: Iterable = ()) -> dict:
    """Места для гостя: «в номер» — только тому, у кого номер есть."""
    room = session.room.number if session.room_id else None
    return locations_payload(language=language, room_number=room, item_ids=item_ids)


def categories_of_items(item_ids: Iterable) -> set[str]:
    from django.core.exceptions import ValidationError as DjangoValidationError

    from apps.catalog.models import Item

    ids = [str(pk).strip() for pk in item_ids if str(pk).strip()]
    if not ids:
        return set()
    try:
        return {
            str(pk)
            for pk in Item.objects.filter(pk__in=ids).values_list("category_id", flat=True)
        }
    except (DjangoValidationError, ValueError):
        return set()


def locations_payload(
    *, language: str, room_number: str | None, item_ids: Iterable = ()
) -> dict:
    """
    ОТ СЕССИИ ЗДЕСЬ ЗАВИСИТ РОВНО ОДНО — НОМЕР ГОСТЯ. Вынесено доводом, чтобы
    показ витрины в настройке бренда звал ТОТ ЖЕ сборщик: оператор смотрит на
    экран оформления глазами гостя без номера.

    `item_ids` — позиции корзины (одного заведения): места отбираются по
    матрице для их категорий.
    """
    has_room = room_number is not None
    categories = categories_of_items(item_ids)

    locations = []
    for location in allowed_locations(categories, has_room=has_room):
        locations.append(
            {
                "id": str(location.pk),
                "code": location.code,
                "kind": location.kind,
                # Как гость получит заказ здесь: несут или заберёт сам.
                "delivery_mode": delivery_mode_of(location),
                "title": location.tr("title", language),
                "requires_refinement": location.requires_refinement,
                "refinement_label": location.tr("refinement_label", language) or None,
                "is_default": location.kind == Location.Kind.IN_ROOM and has_room,
            }
        )

    # Списка способов «на весь отель» больше нет: витрина брала из него первый
    # элемент, и каждый заказ уходил «доставкой», куда бы его ни забирали.
    # Способ — свойство места (`delivery_mode` у каждого).
    return {"room": room_number, "locations": locations}
