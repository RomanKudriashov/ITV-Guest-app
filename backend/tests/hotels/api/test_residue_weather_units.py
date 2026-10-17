"""
ЕДИНИЦЫ ПОГОДЫ ПОСЛЕ ПРЕРВАННОГО АВТОТЕСТА (партия 58б).

У «Кристалла» локально Москва показывала «46°F», на стенде — «11°C». Единицы —
настройка ОТЕЛЯ (не язык и не город): e2e `weather-city` переключал °F и в
конце возвращал прочитанное в начале. Прерванный прогон оставлял °F, следующий
«возвращал» уже °F. Демо-отели — в России, их единицы — °C; уборка следов
тестов возвращает °C.
"""

from __future__ import annotations

import pytest
from django.core.management import call_command

from apps.hotels.models import Hotel

pytestmark = pytest.mark.django_db(databases=["default", "platform"])


def test_residue_cleanup_puts_celsius_back(crystal):
    Hotel.objects.filter(pk=crystal.pk).update(temperature_units="f")

    call_command("clean_test_residue", "--subdomain", "crystal", "--apply", verbosity=0)

    crystal.refresh_from_db()
    assert crystal.temperature_units == "c", "°F автотеста осталась у демо-отеля"


def test_dry_run_reports_but_keeps(crystal, capsys):
    Hotel.objects.filter(pk=crystal.pk).update(temperature_units="f")

    call_command("clean_test_residue", "--subdomain", "crystal")

    crystal.refresh_from_db()
    assert crystal.temperature_units == "f"
    assert "единицы погоды" in capsys.readouterr().out
