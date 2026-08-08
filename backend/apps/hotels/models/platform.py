"""
Платформенные таблицы: шаблоны заведения и системный справочник.

Лежат в apps/hotels, потому что оба описывают, ИЗ ЧЕГО собирается отель,
но принадлежат владельцу платформы, а не отелю: RLS на них нет.
"""

from __future__ import annotations

from django.db import models

from apps.core.fields import TranslatableField
from apps.core.models import BaseModel


class OnboardingTemplate(BaseModel):
    """
    Шаблон заведения отеля: «курорт», «ресторанный отель», «с нуля».

    Хранится ТАБЛИЦЕЙ, а не кодом — в отличие от тарифов (apps/hotels/tariffs.py),
    и это осознанная асимметрия. Тариф — продуктовое обязательство: он связан с
    деньгами и лимитами, меняется вместе с релизом и обязан проходить ревью.
    Шаблон — содержимое: набор сервисов, с которого удобно начать отелю такого
    рода. Его подкручивают, глядя на живые отели, и требовать релиз ради
    переименования сервиса значит гарантировать, что шаблоны отстанут от жизни.

    Шаблон ТОЛЬКО задаёт стартовое состояние. Он не «привязан» к отелю: после
    заведения отель живёт сам, и правка шаблона задним числом ничего у него не
    меняет — иначе платформа могла бы молча переписать чужой отель.
    """

    code = models.SlugField(max_length=64, unique=True)
    title = TranslatableField()
    description = TranslatableField(blank=True)
    tariff = models.CharField(max_length=64, blank=True)
    # Сервисы, которые создаются сразу: [{"type": "restaurant", "name": {...}}].
    services = models.JSONField(default=list, blank=True)
    modules = models.JSONField(default=list, blank=True)
    languages = models.JSONField(default=list, blank=True)
    preset = models.CharField(max_length=64, blank=True)
    is_active = models.BooleanField(default=True)
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "hotels_onboarding_template"
        ordering = ["sort_order", "code"]

    def __str__(self) -> str:
        return self.code

class SystemDictionaryEntry(BaseModel):
    """
    Системный справочник платформы: аллергены и диетические маркеры.

    До R6 этот список жил константами в коде и засевался каждому отелю при
    заведении. Проблема была не в константах, а в том, что платформа не могла
    ДОБАВИТЬ запись: четырнадцать обязательных аллергенов — требование закона,
    и меняется оно не по нашему релизному календарю.

    Отель по-прежнему получает СВОЮ копию записей при заведении и волен их
    деактивировать: справочник платформы — источник, а не поводок. Правка здесь
    не переписывает существующие отели молча; она достаётся новым и приезжает в
    старые только явным действием.
    """

    class Kind(models.TextChoices):
        ALLERGEN = "allergen", "Аллерген"
        MARKER = "marker", "Диетический маркер"

    kind = models.CharField(max_length=16, choices=Kind.choices)
    code = models.SlugField(max_length=64)
    title = TranslatableField()
    is_active = models.BooleanField(default=True)
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "hotels_system_dictionary"
        ordering = ["kind", "sort_order", "code"]
        constraints = [
            models.UniqueConstraint(fields=["kind", "code"], name="uniq_system_dict_entry"),
        ]

    def __str__(self) -> str:
        return f"{self.kind}:{self.code}"
