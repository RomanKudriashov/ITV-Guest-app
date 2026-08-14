"""
Свой домен отеля — не общий.

`custom_domain` не был уникален вовсе, только индексирован. Из него строятся
публичные адреса витрины: QR в номерах, ссылки в письмах, адрес входа
администратора. Два отеля с одним доменом — это два отеля, печатающих на своих
QR один и тот же адрес, и гость одного попадает в другой.

Уникальность частичная: среди ЖИВЫХ и НЕПУСТЫХ. Пустых значений большинство
(домен приводят единицы), а мёртвая строка не должна держать чужой адрес — по
той же причине, по которой у удалённого отеля паркуется поддомен.
"""

from __future__ import annotations

import pytest
from django.db import IntegrityError, transaction

from apps.core.context import platform_scope
from apps.hotels.models import Hotel
from apps.hotels.services.provisioning import provision_hotel

pytestmark = pytest.mark.django_db(transaction=True, databases=["default", "platform"])

DOMAIN = "menu.example-hotel.ru"


def _hotel(subdomain: str) -> Hotel:
    return provision_hotel(
        subdomain=subdomain, name=subdomain.title(),
        admin_email=f"a@{subdomain}.test", admin_password="x-12345",
    ).hotel


def test_two_live_hotels_cannot_share_a_domain():
    """ГЛАВНОЕ. Второй отель с тем же доменом не заводится."""
    first, second = _hotel("dom1"), _hotel("dom2")

    with platform_scope():
        Hotel.all_objects.using("platform").filter(pk=first.pk).update(custom_domain=DOMAIN)

        with pytest.raises(IntegrityError):
            with transaction.atomic(using="platform"):
                Hotel.all_objects.using("platform").filter(pk=second.pk).update(
                    custom_domain=DOMAIN
                )


def test_empty_domain_is_not_a_value():
    """Пустых значений большинство — общий unique запретил бы второй отель."""
    _hotel("dom3")
    _hotel("dom4")

    with platform_scope():
        empty = Hotel.all_objects.using("platform").filter(custom_domain="").count()
    assert empty >= 2, "пустой домен обязан оставаться повторяемым"


def test_deleted_hotel_releases_its_domain():
    """Удалённый отель адрес не держит — иначе домен сгорал бы как поддомен."""
    gone, fresh = _hotel("dom5"), _hotel("dom6")

    with platform_scope():
        Hotel.all_objects.using("platform").filter(pk=gone.pk).update(custom_domain=DOMAIN)
        Hotel.all_objects.using("platform").get(pk=gone.pk).delete()

        # Тот же домен свободен для живого отеля.
        Hotel.all_objects.using("platform").filter(pk=fresh.pk).update(custom_domain=DOMAIN)
        assert (
            Hotel.all_objects.using("platform").get(pk=fresh.pk).custom_domain == DOMAIN
        )
