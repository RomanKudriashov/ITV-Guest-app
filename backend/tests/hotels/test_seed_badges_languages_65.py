"""
Бейджи демо-сева — на всех четырёх языках (партия 65).

Пресеты заводились на ru/en: гость Кристалла на китайском и арабском видел
«Хит» и «Выбор шефа» по-русски. Повторный сев дополняет недостающие языки у
уже заведённых бейджей и не трогает то, что задал отель.
"""

from __future__ import annotations

import pytest

from apps.catalog.models import Badge
from apps.core.context import tenant_context
from apps.hotels.management.commands.seed_demo_hotel import Command

pytestmark = pytest.mark.django_db


def test_bite_reseed_fills_missing_languages_and_keeps_hotel_wording(crystal):
    with tenant_context(crystal):
        Badge.objects.filter(preset__in=["hit", "chef_choice"]).delete()
        Badge.objects.create(hotel_id=crystal.id, preset="hit", label={"ru": "Хит", "en": "Bestseller"})
        Badge.objects.create(hotel_id=crystal.id, preset="chef_choice", label={"ru": "Выбор шефа", "en": "Chef's choice"})
        Command()._seed_marketing_badges()
        hit = Badge.objects.get(preset="hit")
        chef = Badge.objects.get(preset="chef_choice")

    assert hit.label["en"] == "Bestseller", "заданное отелем не перетирается"
    assert hit.label["zh"] and hit.label["ar"]
    assert set(chef.label) >= {"ru", "en", "zh", "ar"}
