"""
Проверка «тот ли код на стенде» по умолчанию — на ГЛАВНОЙ базе (партия 51).

С партии 50 главная база стенда — naviroom; sslip остаётся второй и
проверяется вторым прогоном явным адресом.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "check_stand_api.py"


def _module():
    spec = importlib.util.spec_from_file_location("check_stand_api", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_without_an_argument_the_main_base_is_checked():
    """УКУС. Без аргумента — отель на главной базе (naviroom), а не подсказка и выход."""
    assert _module().stand_url(["check_stand_api.py"], {}) == "https://crystal.naviroom.navicentric.ru"


def test_the_main_base_follows_app_domains_and_the_hotel_is_a_parameter():
    url = _module().stand_url(
        ["check_stand_api.py"], {"APP_DOMAINS": "naviroom.example.test,app.10.0.0.1.sslip.io", "STAND_HOTEL": "azure"}
    )
    assert url == "https://azure.naviroom.example.test"


def test_an_explicit_address_wins_for_the_second_run():
    url = _module().stand_url(["check_stand_api.py", "https://crystal.app.10.0.0.1.sslip.io"], {})
    assert url == "https://crystal.app.10.0.0.1.sslip.io"
