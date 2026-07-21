"""
WebSocket-слой (Channels).

Два канала:
  * /ws/tracker/            — доска исполнения (каркас; UI трекера — следующий
                              прогон).
  * /ws/guest/order/<id>/   — гость следит за своим заказом.

ГЛАВНОЕ РЕШЕНИЕ: реконсиляция, а не дельты. Сервер шлёт ПОЛНЫЙ снимок заказа
сразу после подключения и на каждое событие; клиент своё состояние не
«докручивает», а заменяет. Это снимает целый класс багов рассинхрона —
пропущенное сообщение, переподключение после потери сети, гонка WS с REST.
Цена — чуть больший объём сообщений, и она того стоит.
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

    # В деве поддомена нет: WS идёт мимо vite-прокси и заголовков, поэтому
    # отель приходит query-параметром. В проде он берётся из Host.
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
            user.assignments.filter(is_active=True).values_list("execution_point_id", flat=True)
        )
        return user, [str(pk) for pk in points]


@database_sync_to_async
def _load_guest_order(hotel, token: str, order_id: str, language: str):
    """
    Аутентификация и снимок одним походом в БД: соединение либо сразу
    осмысленно, либо не открывается.
    """
    from apps.accounts.auth import authenticate_guest
    from apps.orders.services import get_order, serialize_order

    with tenant_context(hotel, language=language or None):
        session = authenticate_guest(token)
        if session is None:
            return None, None
        try:
            order = get_order(order_id, guest_session=session)
        except Exception:  # noqa: BLE001 — чужой или несуществующий заказ
            return session, None
        return session, serialize_order(order, language or None)


@database_sync_to_async
def _order_snapshot(hotel, order_id: str, language: str):
    from apps.orders.services import get_order, serialize_order

    with tenant_context(hotel, language=language or None):
        try:
            return serialize_order(get_order(order_id), language or None)
        except Exception:  # noqa: BLE001 — заказ мог быть удалён
            logger.warning("Не удалось собрать снимок заказа %s", order_id, exc_info=True)
            return None


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
        self.groups_joined = [f"tracker.{self.hotel_id}.{pk}" for pk in execution_point_ids]
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
        try:
            message = json.loads(text_data or "{}")
        except json.JSONDecodeError:
            return
        if message.get("type") == "ping":
            await self.send_json({"type": "pong"})

    async def order_event(self, message):
        await self.send_json(message)


class GuestOrderConsumer(AsyncJsonWebsocketConsumer):
    """Живой статус одного заказа для гостя, который его сделал."""

    async def connect(self):
        hotel = await _resolve_hotel(self.scope)
        if hotel is None:
            await self.close(code=CLOSE_NO_TENANT)
            return

        self.hotel = hotel
        self.order_id = str(self.scope["url_route"]["kwargs"]["order_id"])
        self.language = _query_param(self.scope, "lang")
        token = _query_param(self.scope, "token")

        session, snapshot = await _load_guest_order(hotel, token, self.order_id, self.language)
        if session is None or snapshot is None:
            await self.close(code=CLOSE_UNAUTHORIZED)
            return

        self.group_name = f"order.{hotel.pk}.{self.order_id}"
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

        # Первый снимок — сразу. Клиенту не нужно отдельно дёргать REST, а
        # переподключение после потери сети само себя лечит.
        await self.send_json({"type": "order.snapshot", "event": "connected", "order": snapshot})

    async def disconnect(self, code):
        group = getattr(self, "group_name", None)
        if group:
            await self.channel_layer.group_discard(group, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        try:
            message = json.loads(text_data or "{}")
        except json.JSONDecodeError:
            return
        if message.get("type") == "ping":
            await self.send_json({"type": "pong"})

    async def order_event(self, message):
        """
        Событие из шины — только повод перечитать заказ. В сообщении шины лежит
        компактный payload, а гостю нужен полный объект: собираем снимок
        заново, чтобы формат REST и WS был буквально одним и тем же.
        """
        snapshot = await _order_snapshot(self.hotel, self.order_id, self.language)
        if snapshot is None:
            return
        await self.send_json(
            {
                "type": "order.snapshot",
                "event": message.get("event", ""),
                "order": snapshot,
            }
        )
