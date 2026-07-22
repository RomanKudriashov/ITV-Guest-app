"""
WebSocket-слой (Channels).

Два канала:
  * /ws/tracker/<point>/    — доска точки исполнения для персонала.
  * /ws/guest/order/<id>/   — гость следит за своим заказом.

У WebSocket НЕТ HTTP-middleware: ни аутентификации, ни резолвера тенанта, ни
языка. Каждый консьюмер обязан делать это сам и явно — иначе канал окажется
открыт наружу. Проверки берутся из тех же сервисных функций, что использует
REST, чтобы правила не разъехались.

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
def _load_tracker_board(hotel, token: str, point_code: str, language: str):
    """
    Аутентификация + скоуп отеля + проверка привязки к точке + снимок доски —
    одним походом в БД.

    Всё перечисленное делается ЯВНО, потому что у WebSocket нет ни middleware
    аутентификации, ни резолвера тенанта, ни языка. Проверки живут в
    apps/orders/tracker.py, то есть буквально те же, что у REST: разъехаться
    им негде.
    """
    from apps.accounts.auth import authenticate_staff
    from apps.core.errors import DomainError
    from apps.orders.tracker import build_board, require_point

    language = language or hotel.default_language
    with tenant_context(hotel, language=language):
        user = authenticate_staff(token)
        if user is None:
            return None, None, None
        try:
            point = require_point(user, point_code)
        except DomainError:
            return user, None, None
        return user, point, build_board(point, language=language)


@database_sync_to_async
def _board_snapshot(hotel, point_id, language: str):
    from apps.hotels.models import ExecutionPoint
    from apps.orders.tracker import build_board

    language = language or hotel.default_language
    with tenant_context(hotel, language=language):
        point = ExecutionPoint.objects.filter(pk=point_id).first()
        if point is None:
            return None
        return build_board(point, language=language)


@database_sync_to_async
def _load_guest_order(hotel, token: str, order_id: str, language: str):
    """
    Аутентификация и снимок одним походом в БД: соединение либо сразу
    осмысленно, либо не открывается.
    """
    from apps.accounts.auth import authenticate_guest
    from apps.orders.services import get_order, serialize_order

    # Язык по умолчанию — язык ОТЕЛЯ, а не глобальный en. У WebSocket нет ни
    # middleware, ни Accept-Language, поэтому без этой подстановки снимок
    # приезжал бы на английском в русском отеле.
    language = language or hotel.default_language
    with tenant_context(hotel, language=language):
        session = authenticate_guest(token)
        if session is None:
            return None, None
        try:
            order = get_order(order_id, guest_session=session)
        except Exception:  # noqa: BLE001 — чужой или несуществующий заказ
            return session, None
        return session, serialize_order(order, language)


@database_sync_to_async
def _order_snapshot(hotel, order_id: str, language: str):
    from apps.orders.services import get_order, serialize_order

    language = language or hotel.default_language
    with tenant_context(hotel, language=language):
        try:
            return serialize_order(get_order(order_id), language)
        except Exception:  # noqa: BLE001 — заказ мог быть удалён
            logger.warning("Не удалось собрать снимок заказа %s", order_id, exc_info=True)
            return None


class TrackerConsumer(AsyncJsonWebsocketConsumer):
    """
    Доска точки исполнения. Подключиться можно только к СВОЕЙ точке — той, к
    которой сотрудника привязали StaffAssignment. Повару с кухни незачем
    видеть заявки SPA, а сотруднику соседнего отеля — вообще ничего.
    """

    async def connect(self):
        hotel = await _resolve_hotel(self.scope)
        if hotel is None:
            await self.close(code=CLOSE_NO_TENANT)
            return

        self.hotel = hotel
        self.language = _query_param(self.scope, "lang")
        point_code = self.scope["url_route"]["kwargs"]["point_code"]
        token = _query_param(self.scope, "token")

        user, point, board = await _load_tracker_board(
            hotel, token, point_code, self.language
        )
        if user is None:
            await self.close(code=CLOSE_UNAUTHORIZED)
            return
        if point is None:
            # Одинаковый отказ и для «точки нет», и для «не твоя точка»:
            # чужому незачем узнавать, какие точки существуют в отеле.
            await self.close(code=CLOSE_FORBIDDEN)
            return

        self.point_id = str(point.pk)
        self.group_name = f"tracker.{hotel.pk}.{point.pk}"
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

        await self.send_json(
            {
                "type": "tracker.snapshot",
                "event": "connected",
                "order_id": None,
                "board": board,
            }
        )

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
        Событие из шины — повод переслать доску целиком, а не патч.

        Полный снимок на каждое событие — осознанный размен: на кухне
        одновременно живут единицы заказов, и простота инварианта важнее
        экономии трафика. `order_id` отдаём отдельно, чтобы клиент знал, что
        подсветить и на что дать звук.
        """
        board = await _board_snapshot(self.hotel, self.point_id, self.language)
        if board is None:
            return
        await self.send_json(
            {
                "type": "tracker.snapshot",
                "event": message.get("event", ""),
                "order_id": (message.get("data") or {}).get("order_id"),
                "board": board,
            }
        )


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


# --- Чат: гость и персонал -------------------------------------------------
# Та же реконсиляция снимком. У WS нет middleware, поэтому авторизация и скоуп
# резолвятся явно: гость ↔ ТОЛЬКО свой тред, сотрудник ↔ треды своего отеля.


@database_sync_to_async
def _load_guest_thread(hotel, token: str, language: str):
    from apps.accounts.auth import authenticate_guest
    from apps.chat.services import get_or_create_thread, thread_snapshot

    language = language or hotel.default_language
    with tenant_context(hotel, language=language):
        session = authenticate_guest(token)
        if session is None:
            return None, None
        thread = get_or_create_thread(session)
        return thread, thread_snapshot(thread, side="guest")


@database_sync_to_async
def _guest_thread_snapshot(hotel, thread_id, language):
    from apps.chat.models import ChatThread
    from apps.chat.services import thread_snapshot

    with tenant_context(hotel, language=language or hotel.default_language):
        thread = ChatThread.objects.filter(pk=thread_id).first()
        return thread_snapshot(thread, side="guest") if thread else None


@database_sync_to_async
def _load_staff_thread(hotel, token: str, thread_id: str, language: str):
    from apps.accounts.auth import authenticate_staff
    from apps.chat.models import ChatThread
    from apps.chat.services import thread_snapshot

    language = language or hotel.default_language
    with tenant_context(hotel, language=language):
        user = authenticate_staff(token)
        if user is None:
            return None, None
        # Скоуп отеля обеспечивает RLS: чужой тред не найдётся.
        thread = ChatThread.objects.filter(pk=thread_id).first()
        if thread is None:
            return user, None
        return user, thread_snapshot(thread, side="staff")


@database_sync_to_async
def _staff_thread_snapshot(hotel, thread_id, language):
    from apps.chat.models import ChatThread
    from apps.chat.services import thread_snapshot

    with tenant_context(hotel, language=language or hotel.default_language):
        thread = ChatThread.objects.filter(pk=thread_id).first()
        return thread_snapshot(thread, side="staff") if thread else None


class GuestChatConsumer(AsyncJsonWebsocketConsumer):
    """Чат гостя: подключается к своему треду (по номеру/сессии)."""

    async def connect(self):
        hotel = await _resolve_hotel(self.scope)
        if hotel is None:
            await self.close(code=CLOSE_NO_TENANT)
            return

        self.hotel = hotel
        self.language = _query_param(self.scope, "lang")
        token = _query_param(self.scope, "token")

        thread, snapshot = await _load_guest_thread(hotel, token, self.language)
        if thread is None:
            await self.close(code=CLOSE_UNAUTHORIZED)
            return

        self.thread_id = str(thread.pk)
        self.group_name = f"chat.{hotel.pk}.{self.thread_id}"
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        await self.send_json({"type": "chat.snapshot", "event": "connected", "thread": snapshot})

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

    async def chat_event(self, message):
        snapshot = await _guest_thread_snapshot(self.hotel, self.thread_id, self.language)
        if snapshot is not None:
            await self.send_json(
                {"type": "chat.snapshot", "event": message.get("event", ""), "thread": snapshot}
            )


class StaffChatConsumer(AsyncJsonWebsocketConsumer):
    """Чат персонала: тред своего отеля (скоуп через RLS)."""

    async def connect(self):
        hotel = await _resolve_hotel(self.scope)
        if hotel is None:
            await self.close(code=CLOSE_NO_TENANT)
            return

        self.hotel = hotel
        self.language = _query_param(self.scope, "lang")
        self.thread_id = str(self.scope["url_route"]["kwargs"]["thread_id"])
        token = _query_param(self.scope, "token")

        user, snapshot = await _load_staff_thread(hotel, token, self.thread_id, self.language)
        if user is None:
            await self.close(code=CLOSE_UNAUTHORIZED)
            return
        if snapshot is None:
            await self.close(code=CLOSE_FORBIDDEN)
            return

        self.group_name = f"chat.{hotel.pk}.{self.thread_id}"
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        await self.send_json({"type": "chat.snapshot", "event": "connected", "thread": snapshot})

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

    async def chat_event(self, message):
        snapshot = await _staff_thread_snapshot(self.hotel, self.thread_id, self.language)
        if snapshot is not None:
            await self.send_json(
                {"type": "chat.snapshot", "event": message.get("event", ""), "thread": snapshot}
            )
