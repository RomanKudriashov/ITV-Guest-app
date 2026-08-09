"""
Выборки, которые нужны вьюхам входа.

Перенос дословный из api/staff.py: вьюха разбирает запрос и зовёт сервис, а
ходить в базу — работа сервиса.
"""

from __future__ import annotations

from apps.core.context import require_hotel_id

from apps.accounts.models import User


def staff_user(user_id) -> User:
    return User.objects.get(pk=user_id)


def staff_login_hotel():
    """Отель, в рамках которого идёт вход. Тенант уже выбран поддоменом."""
    from apps.hotels.models import Hotel

    return Hotel.objects.get(pk=require_hotel_id())
