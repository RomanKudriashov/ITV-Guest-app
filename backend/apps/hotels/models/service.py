"""
Заведения и услуги отеля.
"""

from __future__ import annotations

from django.db import models

from apps.core.fields import TranslatableField
from apps.core.models import TenantModel

from .execution_point import ExecutionPoint
from .hotel import Hotel


class Service(TenantModel):
    """
    Гостевой сервис — типизированный контейнер: ресторан, бар, спа, такси,
    консьерж, рум-сервис, инфо-раздел, мини-бар. Надстройка над исполнителем
    (ExecutionPoint): сервис несёт гостевую идентичность, тип-шаблон, венью-
    расписание и свою коммерцию; исполнение (кухня/бригада, маршрут заказа,
    трекер, персонал, эскалации) остаётся на ExecutionPoint.

    В R1 связь 1:1 (unique по execution_point). FK, а не OneToOne, потому что R2
    ослабит её под заимствование чужого контента и разъезд заказа по нескольким
    исполнителям (fan-out) — тип поля тогда менять не придётся.

    Пять слоёв (docs/design/guest-hub-design-map.md, Часть 0):
      1. тип/шаблон — из каких кирпичей собран (Service.Type поверх OfferingType);
      2. наполнение — Category.service → контент сервиса;
      3. доступность — schedule (венью-часы) + локации (пока на уровне категории);
      4. исполнение — execution_point (исполнитель по умолчанию);
      5. коммерция — свои сбор/чаевые/минимум/доставка (null = наследовать отель).
    """

    class Type(models.TextChoices):
        RESTAURANT = "restaurant", "Ресторан"
        BAR = "bar", "Бар"
        ROOM_SERVICE = "room_service", "Рум-сервис"
        SPA = "spa", "SPA"
        POOL = "pool", "Бассейн"
        TRANSFER = "transfer", "Трансфер/такси"
        CONCIERGE = "concierge", "Консьерж"
        EXCURSIONS = "excursions", "Экскурсии"
        HOUSEKEEPING = "housekeeping", "Хозслужба"
        MINIBAR = "minibar", "Мини-бар/магазин"
        INFO = "info", "Инфо-раздел"
        CUSTOM = "custom", "Свой"

    code = models.SlugField(max_length=64)
    type = models.CharField(max_length=32, choices=Type.choices, default=Type.CUSTOM)
    # Исполнитель по умолчанию. 1:1 в R1 (unique ниже); PROTECT — сервис нельзя
    # осиротить, удаление исполнителя идёт через удаление сервиса.
    execution_point = models.ForeignKey(
        ExecutionPoint, on_delete=models.PROTECT, related_name="services"
    )

    # --- Гостевая идентичность (перенесена с ExecutionPoint в R1) ---
    public_name = TranslatableField()
    tagline = TranslatableField()
    # Показывать ли сервис гостю как заведение на витрине. Служебные (хозслужба,
    # кухня рум-сервиса) — false.
    is_guest_facing = models.BooleanField(default=True)
    image = models.ForeignKey(
        "media.MediaAsset", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    # Венью-часы (перенесены с ExecutionPoint). Доступность категорий/позиций
    # считается их собственными расписаниями; это — часы самого заведения,
    # которые витрина показывает пилюлей «открыто до 23:00».
    schedule = models.ForeignKey(
        "hotels.Schedule", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    is_active = models.BooleanField(default=True)
    sort_order = models.PositiveSmallIntegerField(default=0)

    # --- Коммерция уровня сервиса. null = наследовать значение отеля. Налог,
    # валюта и налоговый режим остаются на отеле (единственная коммерция уровня
    # отеля — по карте продукта). Пока оверрайд null, суммы те же, что и были. ---
    service_fee_bp = models.PositiveIntegerField(null=True, blank=True)
    tip_presets = models.JSONField(null=True, blank=True)
    min_order_minor = models.IntegerField(null=True, blank=True)
    free_delivery_threshold_minor = models.IntegerField(null=True, blank=True)
    price_round_to_minor = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        db_table = "hotels_service"
        ordering = ["sort_order", "code"]
        constraints = [
            models.UniqueConstraint(fields=["hotel", "code"], name="uniq_service_per_hotel"),
            models.UniqueConstraint(
                fields=["hotel", "execution_point"], name="uniq_service_per_execution_point"
            ),
        ]

    def __str__(self) -> str:
        return self.code

    @property
    def public_title(self) -> dict:
        """Гостевое название с падением на служебное имя исполнителя."""
        return self.public_name or self.execution_point.title or {}

    def commerce_value(self, hotel: "Hotel", field: str):
        """
        Эффективное значение коммерч. поля: оверрайд сервиса, иначе — отеля.
        Единственное место, где живёт правило фолбэка «сервис → отель».
        """
        own = getattr(self, field)
        return own if own is not None else getattr(hotel, field)
