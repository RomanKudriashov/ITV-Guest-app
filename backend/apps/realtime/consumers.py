"""
WebSocket-слой (Channels).

Каркас двух каналов:
  * /ws/tracker/  — доска исполнения. Сотрудник подписывается на группы своих
                    точек исполнения.
  * /ws/order/<id>/ — гость следит за своим заказом.

Полноценный трекер (действия, назначение, drag-n-drop) — следующим прогоном;
здесь фиксируется контракт: события из шины прилетают методом order_event.
"""

from __future__ import annotations

import json
import logging
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from apps.core.context import tenant_context
from apps.core.middleware import resolve_subdomain

logger = logging.getLogger(__name__)

# Коды закрытия — чтобы фронт мог отличить «не тот отель» от «протух токен».
CLOSE_NO_TENANT = 4404
CLOSE_UNAUTHORIZED = 4401
CLOSE_FORBIDDEN = 4403


def _query_param(scope, name: str) -> str:
    query = parse_qs((scope.get("query_string") or b"").decode())
    values = query.get(name) or []
    return values[0] if values else ""


def _host(scope) -> str:
    for key, value in scope.get("headers", []):
        if key == b"host":
            return value.decode()
    return ""


@database_sync_to_async
def _resolve_hotel(scope):
    from apps.hotels.models import Hotel

    subdomain = _query_param(scope, "hotel") or resolve_subdomain(_host(scope))
    if not subdomain:
        return None
    return Hotel.objects.filter(subdomain=subdomain, is_active=True).first()


@database_sync_to_async
def _authenticate_staff(hotel, token: str):
    from apps.accounts.auth import authenticate_staff

    with tenant_context(hotel):
        user = authenticate_staff(token)
        if user is None:
            return None, []
        points = list(
            user.assignments.filter(is_active=True).values_list(
                "execution_point_id", flat=True
            )
        )
        return user, [str(pk) for pk in points]


@database_sync_to_async
def _authenticate_guest_for_order(hotel, token: str, order_id: str):
    from apps.accounts.auth import authenticate_guest
    from apps.orders.models import Order

    with tenant_context(hotel):
        session = authenticate_guest(token)
        if session is None:
            return None
        order = Order.objects.filter(pk=order_id, guest_session_id=session.pk).first()
        return order


class TrackerConsumer(AsyncJsonWebsocketConsumer):
    """Доска исполнения. Подписка — только на свои точки исполнения."""

    async def connect(self):
        hotel = await _resolve_hotel(self.scope)
        if hotel is None:
            await self.close(code=CLOSE_NO_TENANT)
            return

        token = _query_param(self.scope, "token")
        user, execution_point_ids = await _authenticate_staff(hotel, token)
        if user is None:
            await self.close(code=CLOSE_UNAUTHORIZED)
            return
        if not execution_point_ids:
            await self.close(code=CLOSE_FORBIDDEN)
            return

        self.hotel_id = str(hotel.pk)
        self.groups_joined = [
            f"tracker.{self.hotel_id}.{pk}" for pk in execution_point_ids
        ]
        for group in self.groups_joined:
            await self.channel_layer.group_add(group, self.channel_name)

        await self.accept()
        await self.send_json(
            {"type": "connected", "hotel_id": self.hotel_id, "channels": self.groups_joined}
        )

    async def disconnect(self, code):
        for group in getattr(self, "groups_joined", []):
            await self.channel_layer.group_discard(group, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        # Управляющие команды (взять в работу, сменить статус) появятся вместе
        # с трекером. Пока — только ping, чтобы держать соединение живым.
        try:
            message = json.loads(text_data or "{}")
        except json.JSONDecodeError:
            return
        if message.get("type") == "ping":
            await self.send_json({"type": "pong"})

    async def order_event(self, message):
        await self.send_json(message)


class GuestOrderConsumer(AsyncJsonWebsocketConsumer):
    """Статус конкретного заказа для гостя, который его сделал."""

    async def connect(self):
        hotel = await _resolve_hotel(self.scope)
        if hotel is None:
            await self.close(code=CLOSE_NO_TENANT)
            return

        order_id = self.scope["url_route"]["kwargs"]["order_id"]
        token = _query_param(self.scope, "token")
        order = await _authenticate_guest_for_order(hotel, token, order_id)
        if order is None:
            await self.close(code=CLOSE_UNAUTHORIZED)
            return

        self.group_name = f"order.{hotel.pk}.{order.pk}"
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        await self.send_json({"type": "connected", "order_id": str(order.pk)})

    async def disconnect(self, code):
        group = getattr(self, "group_name", None)
        if group:
            await self.channel_layer.group_discard(group, self.channel_name)

    async def order_event(self, message):
        await self.send_json(message)
