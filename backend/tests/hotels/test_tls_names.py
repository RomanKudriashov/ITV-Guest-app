"""
Имена сертификата — из баз и отелей, без правки кода при новом отеле (партия 39).
"""

from __future__ import annotations

import pytest
from django.test import override_settings

from apps.hotels.management.commands.tls_names import certificate_names

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

BASES = ["naviapp.example.test", "app.10.0.0.1.sslip.io"]


@override_settings(GUEST_APP_BASE_DOMAINS=BASES)
def test_every_base_and_every_live_hotel_under_each_base(crystal):
    from apps.hotels.models import Hotel

    Hotel.all_objects.using("platform").filter(pk=crystal.pk).update(custom_domain="menu.crystal-hotel.test")
    Hotel.all_objects.using("platform").create(name={"ru": "Автотест"}, subdomain="autotestx", origin=Hotel.Origin.TEST)
    names = certificate_names()
    for base in BASES:
        assert base in names
        assert f"crystal.{base}" in names, "отель — под каждой базой"
    assert "menu.crystal-hotel.test" in names, "собственный домен отеля — тоже"
    assert not any(name.startswith("autotestx.") for name in names), "отели автотестов в сертификат не идут"
    assert len(names) == len(set(names))
