"""
Реестр поведений типов предложений.

Здесь — ЕДИНСТВЕННОЕ место, где система знает, чем еда отличается от
заявки-услуги. Прикладной код спрашивает у реестра флаг, а не сравнивает
строку типа:

    behaviour = behaviour_for(item.type)
    if behaviour.uses_fields:            # а НЕ: if item.type == "service_request"
        ...

Правило на будущее (`info`, `slot_booking`): новый тип — это новая строка в
этой таблице. Если тип потребовал форка Order, гостевого потока или трекера,
значит треснула модель, и чинить надо её, а не городить ветки.

Подробности и обоснования — docs/offering-types.md.
"""

from __future__ import annotations

import dataclasses

from django.db import models


class OfferingType(models.TextChoices):
    PRODUCT = "product", "Товар/блюдо"
    SERVICE_REQUEST = "service_request", "Заявка-услуга"
    INFO = "info", "Инфо-страница"
    SLOT = "slot", "Бронь слота"


class LocationMode(models.TextChoices):
    """
    Нужна ли заявке локация — и какая.

    Раньше витрина всегда спрашивала «куда доставить». Для такси это
    бессмысленно (точка подачи — поле заявки), для уборки избыточно (номер и
    так известен). Поэтому режим — свойство позиции, а не константа.
    """

    DELIVERY = "delivery", "Спросить локацию"
    ROOM = "room", "Номер гостя"
    NONE = "none", "Локация не нужна"


@dataclasses.dataclass(frozen=True, slots=True)
class OfferingBehaviour:
    code: str
    order_type: str
    # Создаёт ли тип заказ вообще. info — единственный, кто нет: это страница
    # только для чтения. Ради этого флага гостевой поток получил ровно одну
    # развилку «эту позицию нельзя заказать».
    creates_order: bool
    allows_multiple_lines: bool
    uses_modifiers: bool
    uses_fields: bool
    uses_content: bool
    uses_slots: bool
    default_location_mode: str
    # Обязательна ли цена. «Цена не указана» — это свойство ПОЗИЦИИ (у такси
    # цена может быть, у уборки нет), поэтому здесь только требование, а не
    # утверждение «услуги бесплатны».
    requires_price: bool


BEHAVIOURS: dict[str, OfferingBehaviour] = {
    OfferingType.PRODUCT: OfferingBehaviour(
        code=OfferingType.PRODUCT,
        order_type="cart",
        creates_order=True,
        allows_multiple_lines=True,
        uses_modifiers=True,
        uses_fields=False,
        uses_content=False,
        uses_slots=False,
        default_location_mode=LocationMode.DELIVERY,
        requires_price=True,
    ),
    OfferingType.SERVICE_REQUEST: OfferingBehaviour(
        code=OfferingType.SERVICE_REQUEST,
        order_type="request",
        creates_order=True,
        allows_multiple_lines=False,
        uses_modifiers=False,
        uses_fields=True,
        uses_content=False,
        uses_slots=False,
        default_location_mode=LocationMode.ROOM,
        requires_price=False,
    ),
    OfferingType.INFO: OfferingBehaviour(
        code=OfferingType.INFO,
        order_type="none",
        creates_order=False,
        allows_multiple_lines=False,
        uses_modifiers=False,
        uses_fields=False,
        uses_content=True,
        uses_slots=False,
        default_location_mode=LocationMode.NONE,
        requires_price=False,
    ),
    OfferingType.SLOT: OfferingBehaviour(
        code=OfferingType.SLOT,
        order_type="booking",
        creates_order=True,
        allows_multiple_lines=False,
        uses_modifiers=False,
        uses_fields=False,
        uses_content=False,
        uses_slots=True,
        default_location_mode=LocationMode.NONE,
        requires_price=False,
    ),
}


def behaviour_for(offering_type: str) -> OfferingBehaviour:
    """Неизвестный тип трактуем как товар: это самый строгий набор правил."""
    return BEHAVIOURS.get(offering_type, BEHAVIOURS[OfferingType.PRODUCT])
