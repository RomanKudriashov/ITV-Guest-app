"""Схемы трекера. Объявлялись во вьюхе; имена не менялись."""

from __future__ import annotations

from ninja import Schema


class StatusIn(Schema):
    status: str
    comment: str = ""


class CancelIn(Schema):
    """
    `cancel_reason` — КОД из справочника `Order.CancelReason`, обязателен.
    `reason` — необязательное уточнение словами, попадает в журнал.
    """

    cancel_reason: str = ""
    reason: str = ""


class AcceptIn(Schema):
    pass


class PositionIn(Schema):
    """
    Куда встала карточка — СОСЕДЯМИ, а не номером места.

    Номер («поставь третьим») ломается на любой гонке: пока карточку несли,
    сосед по смене убрал заказ сверху, и третье место оказалось не тем, куда
    смотрел человек. Соседи же остаются собой: «между этими двумя» — это то,
    что человек видел на экране в момент броска.

    Пустой `after` — встала первой в колонке, пустой `before` — последней.
    """

    after: str | None = None
    before: str | None = None
