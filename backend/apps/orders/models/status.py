"""
Статусы заявки: словарь отеля и журнал переходов.

Словарь ТАБЛИЦЕЙ, а не перечислением в коде: у ресторана и у хозслужбы разные
наборы шагов, и добавление шага не должно требовать релиза.
"""

from __future__ import annotations

from django.db import models

from apps.core.fields import TranslatableField
from apps.core.models import TenantModel



class StatusDefinition(TenantModel):
    """
    Статусы настраиваются на отель (пресеты заводит apps/orders/status_flows.py),
    а не захардкожены: у ресторана «готовится → в пути», у спа «пришёл →
    завершено».

    С R3 у отеля не один пресет, а по одному на ТИП ТРЕКЕРА (`flow`): доска
    заказов, очередь хозслужбы, записи спа, заявки консьержа. Код уникален
    внутри потока, а не отеля — `new` у доски и `new` у заявок такси ведут в
    разные стороны. Отсюда правило: искать статус по коду можно только вместе
    с потоком (`status_by_code`), иначе однажды заказ уедет в чужой поток.
    """

    code = models.SlugField(max_length=64)
    # Поток = тип трекера (apps/orders/tracker_types.py::TrackerType). Строкой,
    # а не FK: это справочник кода, а не данные отеля.
    flow = models.SlugField(max_length=32, default="board")
    # Нормализованная ступень (status_flows.Stage) поверх потоков. Единственный
    # способ сравнить продвинутость статусов из РАЗНЫХ потоков — этого требует
    # статус-свод разъехавшегося заказа (R2), у которого children могут висеть
    # на досках разных типов.
    stage = models.SlugField(max_length=32, default="new")
    title = TranslatableField()
    sort_order = models.PositiveSmallIntegerField(default=0)
    is_initial = models.BooleanField(default=False)
    is_terminal = models.BooleanField(default=False)
    is_cancelled = models.BooleanField(default=False)
    # Можно ли отменить заказ, находящийся в этом статусе. Настройка отеля, а
    # не константа в коде: где-то отменяют до «Готовится», где-то до самой
    # выдачи. Гость видит кнопку ровно тогда, когда отмена действительно
    # разрешена, — иначе он жмёт её и получает отказ.
    allows_guest_cancel = models.BooleanField(default=False)
    # Имя токена темы, а не цвет: цвета живут только в токенах бренда.
    color_token = models.SlugField(max_length=64, blank=True)

    class Meta:
        db_table = "orders_status_definition"
        ordering = ["sort_order"]
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "flow", "code"], name="uniq_status_code_per_flow"
            )
        ]

    def __str__(self) -> str:
        return f"{self.flow}:{self.code}"

    @property
    def stage_rank(self) -> int:
        from apps.orders.services.status_flows import STAGE_RANK

        return STAGE_RANK.get(self.stage, 0)


class OrderStatusChange(TenantModel):
    """История переходов — для SLA-аналитики и разбора «кто когда взял заказ»."""

    order = models.ForeignKey(
        "orders.Order", on_delete=models.CASCADE, related_name="status_changes")
    from_status = models.ForeignKey(
        StatusDefinition, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    to_status = models.ForeignKey(
        StatusDefinition, on_delete=models.PROTECT, related_name="+"
    )
    actor_type = models.CharField(max_length=16, default="system")
    actor_id = models.UUIDField(null=True, blank=True)
    comment = models.CharField(max_length=255, blank=True)

    class Meta:
        db_table = "orders_order_status_change"
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"{self.order_id}: {self.from_status_id} → {self.to_status_id}"
