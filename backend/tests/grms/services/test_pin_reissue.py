"""
PIN НОМЕРА: СНЯЛИ — МОЖНО ЗАВЕСТИ СНОВА.

`clear_pin` удалял запись мягко: строка оставалась с `deleted_at`, а у номера
PIN один (`OneToOneField`). `set_pin` искал запись менеджером, который мёртвых
не видит, не находил и пробовал вставить вторую — уникальность отбивала, панель
получала 409. Номер, у которого раз нажали «Снять», навсегда оставался без
PIN: в списке его нет, завести нельзя (стенд, 07.10.2026, «Кристалл» 305).

Хеш снятого кода хранить незачем, поэтому снятие — настоящее удаление.
"""

from __future__ import annotations

import pytest

from apps.core.context import tenant_context
from apps.grms.models import RoomPin
from apps.grms.services import pin as room_pin
from apps.hotels.models import Room

pytestmark = pytest.mark.django_db


@pytest.fixture
def room(crystal) -> Room:
    with tenant_context(crystal):
        return Room.objects.get(number="201")


def test_a_cleared_pin_can_be_issued_again(crystal, room):
    """УКУС. Завести → снять → завести: второе заведение проходит."""
    room_pin.set_pin(crystal, room, pin="1111")
    room_pin.clear_pin(crystal, room)

    room_pin.set_pin(crystal, room, pin="2222")

    with tenant_context(crystal):
        record = RoomPin.objects.get(room=room)
        assert record.deleted_at is None
        assert record.pin_hash and not record.pin_hash.endswith("1111")


def test_clearing_leaves_no_row_behind(crystal, room):
    """Снятый код не лежит в базе даже мёртвым — хеш старого PIN ни к чему."""
    room_pin.set_pin(crystal, room, pin="1111")
    room_pin.clear_pin(crystal, room)

    with tenant_context(crystal):
        assert not RoomPin.all_objects.filter(room=room).exists()


def test_a_row_left_soft_deleted_by_the_old_code_is_revived(crystal, room):
    """
    На стенде уже лежат строки, снятые прежним кодом мягко. Заведение обязано
    поднять такую строку, а не упереться в неё.
    """
    room_pin.set_pin(crystal, room, pin="1111")
    with tenant_context(crystal):
        RoomPin.objects.filter(room=room).delete()  # мягко — как делал прежний clear_pin
        assert RoomPin.all_objects.filter(room=room, deleted_at__isnull=False).exists()

    room_pin.set_pin(crystal, room, pin="2222")

    with tenant_context(crystal):
        assert RoomPin.objects.filter(room=room).count() == 1
