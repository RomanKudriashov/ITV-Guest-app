"""
Подключённые модули отеля: что у отеля включено.
"""

from __future__ import annotations

from django.db import models

from apps.core.models import TenantModel


class HotelModule(TenantModel):
    """
    Реестр модулей отеля: что включено — ровно `is_enabled`, включают руками
    по одному (тарифов нет с партии 62-E1, поля тарифа и «намерение» убраны в
    62-E2). Что модуль умеет и готов ли он — `apps.hotels.module_registry`.
    Этот реестр решает, что отель видит в своей CMS: без модуля отель не видит
    ни одного его экрана.
    """

    class Code(models.TextChoices):
        # Подписи — те же слова, что на экране (`MODULE_LABELS`, партия 62-E2).
        ROOM_CONTROL = "room_control", "Управление номером"
        PAYMENT = "payment", "Оплата"
        PMS = "pms", "Система управления отелем"
        MOBILE_KEY = "mobile_key", "Мобильный ключ"
        MULTI_RESTAURANT = "multi_restaurant", "Несколько заведений"
        MARKETING = "marketing", "Маркетинг"
        EXTRA_LANGUAGES = "extra_languages", "Дополнительные языки"
        NATIVE_APP = "native_app", "Приложение отеля"
        ANALYTICS_LEVEL = "analytics_level", "Расширенная аналитика"

    code = models.SlugField(max_length=32)
    is_enabled = models.BooleanField(default=False)
    # Доп. конфигурация модуля (напр. уровень аналитики: {"level": "advanced"}).
    config = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "hotels_hotel_module"
        ordering = ["code"]
        constraints = [
            models.UniqueConstraint(fields=["hotel", "code"], name="uniq_module_per_hotel"),
        ]

    def __str__(self) -> str:
        return f"{self.code}={'on' if self.is_enabled else 'off'}"
