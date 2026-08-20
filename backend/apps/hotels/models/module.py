"""
Подключённые модули отеля: что отель купил.
"""

from __future__ import annotations

from django.db import models

from apps.core.models import TenantModel


class HotelModule(TenantModel):
    """
    Реестр модулей отеля: какие платные фичи включены — по тарифу или точечным
    исключением (выдать модуль вне тарифа пилоту). В R1 — только данные + API;
    управляющий UI — R6, гейтинг CMS-навигации — R4. Именно этот реестр решает,
    что отель видит в своей CMS: без модуля отель не видит ни одного его экрана.
    """

    class Code(models.TextChoices):
        ROOM_CONTROL = "room_control", "Управление номером (GRMS)"
        PAYMENT = "payment", "Оплата"
        PMS = "pms", "PMS"
        MOBILE_KEY = "mobile_key", "Мобильный ключ"
        MULTI_RESTAURANT = "multi_restaurant", "Мультиресторанность"
        MARKETING = "marketing", "Маркетинг"
        EXTRA_LANGUAGES = "extra_languages", "Доп. языки"
        NATIVE_APP = "native_app", "Нативное приложение"
        ANALYTICS_LEVEL = "analytics_level", "Уровень аналитики"

    class Source(models.TextChoices):
        TARIFF = "tariff", "По тарифу"
        OVERRIDE = "override", "Переопределение (вне тарифа)"

    class Intent(models.TextChoices):
        """
        РЕШЕНИЕ ЧЕЛОВЕКА о модуле — отдельно от того, что даёт тариф.

        Пустая строка — не трогали: модуль просто следует за тарифом. `on` и
        `off` — трогали руками, и это решение переживает смену тарифа.

        Раньше здесь стояло вычисляемое `source` («по тарифу» / «вне тарифа»),
        которое пересчитывалось при каждой записи по формуле «override, если
        включено и тариф не даёт». Из-за неё ВЫКЛЮЧЕННЫЙ модуль всегда получал
        «по тарифу», и два разных факта — «мы это выключили» и «тариф этого не
        даёт» — выглядели на экране одинаково. Третьего состояния не
        существовало: его нечем было записать.
        """

        NONE = "", "Не трогали"
        ON = "on", "Включено вручную"
        OFF = "off", "Выключено вручную"

    code = models.SlugField(max_length=32)
    is_enabled = models.BooleanField(default=False)
    intent = models.CharField(max_length=8, choices=Intent.choices, blank=True, default=Intent.NONE)
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
