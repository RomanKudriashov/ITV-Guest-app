"""
ВЫЕЗД ГОСТЯ И СРОК ДЕЙСТВИЯ КОДА.

До этого выезда не было видно вовсе: сессия живёт двенадцать часов и
продлевается входом по номеру комнаты, который знает кто угодно, а отобрать
доступ можно было только сменой PIN — побочным эффектом другого действия.

Три свойства, каждое своим укусом:

* отметили выезд — старый токен больше не отвечает;
* срок кода истёк — код не принимается, и уже выданное подтверждение гаснет;
* подтвердились в комнате заново — прежнее устройство потеряло управление.
"""

from __future__ import annotations

import json
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.core.context import tenant_context
from tests.conftest import host_for

pytestmark = pytest.mark.django_db

PIN = "4271"
# Своя комната, а не демонстрационная 305: у сида в ней уже живут сессии, и
# проверка «отозвана ровно одна» ловила бы чужие. Тест обязан отвечать за то,
# что завёл сам.
ROOM = "990"


@pytest.fixture
def module_on(crystal):
    """
    Управление номером включено: без модуля `/room/verify` отвечает 403
    «модуль не подключён», и проверка про PIN сошлась бы на чужом отказе.
    """
    from apps.hotels.models import HotelModule

    with tenant_context(crystal):
        HotelModule.objects.update_or_create(
            code=HotelModule.Code.ROOM_CONTROL, defaults={"is_enabled": True}
        )


def _room(hotel, number=ROOM):
    from apps.hotels.models import Room

    with tenant_context(hotel):
        room, _ = Room.objects.get_or_create(number=number, defaults={"is_active": True})
    return room


def _guest(client, hotel, number=ROOM) -> str:
    """Гостевая сессия комнаты: токен, как его получает телефон."""
    response = client.post(
        "/api/v1/guest/session",
        data=json.dumps({"room_number": number}),
        content_type="application/json",
        HTTP_HOST=host_for(hotel),
    )
    assert response.status_code == 200, response.content
    return response.json()["token"]


def _verify(client, hotel, token, pin=PIN):
    return client.post(
        "/api/v1/guest/room/verify",
        data=json.dumps({"pin": pin}),
        content_type="application/json",
        HTTP_HOST=host_for(hotel),
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )


def _session_of(client, hotel, token):
    return client.get(
        "/api/v1/guest/session",
        HTTP_HOST=host_for(hotel),
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )


def test_checkout_kills_the_token(client, crystal):
    """
    УКУС. Отметили выезд — старый токен не отвечает.

    Раньше он жил до конца двенадцатичасовой сессии, из любой точки мира:
    выехавший гость продолжал заказывать в номер, где уже живёт другой.
    """
    from apps.accounts.services.guest_checkout import check_out_room

    room = _room(crystal)
    token = _guest(client, crystal)
    assert _session_of(client, crystal, token).status_code == 200

    with tenant_context(crystal):
        result = check_out_room(crystal, room)
    assert result.revoked == 1

    assert _session_of(client, crystal, token).status_code == 401


def test_checkout_is_written_down_with_who_did_it(client, crystal):
    """Журнал отвечает на «кто отметил выезд», а не только «выезд был»."""
    from apps.accounts.services.guest_checkout import ACTION, check_out_room
    from apps.core.models import AuditLog

    room = _room(crystal)
    _guest(client, crystal)

    with tenant_context(crystal):
        check_out_room(crystal, room, actor_id=None)
        entry = AuditLog.objects.filter(action=ACTION).order_by("-created_at").first()

    assert entry is not None, "выезд не попал в журнал"
    assert entry.actor_type == AuditLog.ActorType.STAFF
    assert entry.payload["room"] == room.number
    assert entry.payload["revoked"] == 1


def test_an_expired_pin_is_not_accepted(client, crystal, module_on):
    """
    УКУС. Срок кода истёк — код не принимается.

    Дата выезда ставится при заселении; после неё знание четырёх цифр не
    означает ничего.
    """
    from apps.grms.services import pin as room_pin

    room = _room(crystal)
    room_pin.set_pin(crystal, room, pin=PIN, valid_until=timezone.now() - timedelta(minutes=1))

    token = _guest(client, crystal)
    response = _verify(client, crystal, token)
    assert response.status_code == 403, response.content
    assert response.json()["code"] == "PIN_INVALID"


def test_an_expired_pin_takes_the_confirmation_with_it(client, crystal, module_on):
    """
    УКУС ПОСЕРЬЁЗНЕЕ. Подтверждение, выданное до срока, ПОСЛЕ него не работает.

    Признак лежит полем на сессии и сам по себе бессрочен. Если бы он доживал
    до конца сессии, гость, съехавший в полдень, управлял бы номером до
    вечера — ровно тот случай, ради которого срок и заводят.
    """
    from apps.grms.models import RoomPin
    from apps.grms.services import guest as grms_guest
    from apps.grms.services import pin as room_pin

    room = _room(crystal)
    room_pin.set_pin(crystal, room, pin=PIN, valid_until=timezone.now() + timedelta(hours=2))

    token = _guest(client, crystal)
    assert _verify(client, crystal, token).status_code == 200

    from apps.accounts.models import GuestSession

    with tenant_context(crystal):
        session = GuestSession.objects.get(token_hash=GuestSession.hash_token(token))
        assert grms_guest.room_verified(crystal, session) is True

        # Наступил вечер выезда.
        RoomPin.objects.filter(room=room).update(valid_until=timezone.now() - timedelta(minutes=1))
        session.refresh_from_db()
        assert grms_guest.room_verified(crystal, session) is False, (
            "подтверждение пережило срок действия кода"
        )


def test_a_new_confirmation_takes_control_from_the_previous_device(client, crystal, module_on):
    """
    УКУС. Подтвердились в комнате заново — прежнее устройство потеряло управление.

    Подтверждения копились: телефон, вводивший код месяц назад, оставался
    подтверждённым, пока код не сменят, а между заездами код меняют не всегда.
    Гасится ПОДТВЕРЖДЕНИЕ, а не сессия: корзина и история у прежнего устройства
    остаются.
    """
    from apps.accounts.models import GuestSession
    from apps.grms.services import guest as grms_guest
    from apps.grms.services import pin as room_pin

    room = _room(crystal)
    room_pin.set_pin(crystal, room, pin=PIN)

    first = _guest(client, crystal)
    assert _verify(client, crystal, first).status_code == 200

    second = _guest(client, crystal)
    assert _verify(client, crystal, second).status_code == 200

    with tenant_context(crystal):
        old = GuestSession.objects.get(token_hash=GuestSession.hash_token(first))
        new = GuestSession.objects.get(token_hash=GuestSession.hash_token(second))

        assert grms_guest.room_verified(crystal, new) is True
        assert grms_guest.room_verified(crystal, old) is False, (
            "прежнее устройство сохранило управление номером"
        )

    # Сессия прежнего устройства ЖИВА: у гостя осталась корзина и история.
    assert _session_of(client, crystal, first).status_code == 200
