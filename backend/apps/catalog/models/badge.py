"""
Маркетинговые бейджи и их привязка к позициям.

Бейдж — это витрина, а не свойство блюда: он живёт отдельно и вешается
на позицию набором.
"""

from __future__ import annotations

from django.db import models
from apps.core.fields import TranslatableField
from apps.core.models import TenantModel
from .item import Item


class Badge(TenantModel):
    """
    Маркетинговый бейдж позиции: «Хит», «Новинка», «Выбор шефа». Отдельная
    сущность, не флаги позиции (флаги фактические — аллергены/веган/острое).
    Цвет — РОЛЬ из токенов темы, не произвольный hex: иначе бейдж, заданный под
    тёмную тему, провалит контраст в светлой. Вешается на позицию любого типа.
    """

    class ColorRole(models.TextChoices):
        ACCENT = "accent", "Акцент"
        GOLD = "gold", "Золото"
        SUCCESS = "success", "Успех"
        INFO = "info", "Инфо"

    label = TranslatableField()
    color_role = models.CharField(max_length=16, choices=ColorRole.choices, default=ColorRole.ACCENT)
    sort_order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    # Код пресета, если бейдж заведён из библиотеки (для идемпотентного сида).
    preset = models.SlugField(max_length=64, blank=True)

    class Meta:
        db_table = "catalog_badge"
        ordering = ["sort_order", "id"]

    def __str__(self) -> str:
        return f"badge:{self.label_i18n or self.pk}"

class ItemBadge(TenantModel):
    """
    Назначение бейджа позиции (M2M-через). Join-строки удаляем ЖЁСТКО:
    soft-delete конфликтует с unique-индексом (удалил → назначил снова → дубль).
    Восстановление — через all_objects, как у прочих join-таблиц.
    """

    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name="item_badges")
    badge = models.ForeignKey(Badge, on_delete=models.CASCADE, related_name="item_badges")
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "catalog_item_badge"
        ordering = ["sort_order"]
        constraints = [
            models.UniqueConstraint(fields=["hotel", "item", "badge"], name="uniq_item_badge"),
        ]

    def __str__(self) -> str:
        return f"{self.item_id}:{self.badge_id}"
