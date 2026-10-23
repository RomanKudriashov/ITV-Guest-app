"""
Подключение управления номером в Control (партия 63-3): сервер управления
отеля, цепочка звеньев, проверки. Правка — `WRITE`; у «только чтение» — 403.
"""

from __future__ import annotations

import uuid

from django.http import HttpRequest
from ninja import Schema
from pydantic import Field

from apps.hotels.api.platform.rights import READ, WRITE, PlatformRouter, requires
from apps.hotels.services.platform import console

router = PlatformRouter(tags=["platform"])


class ControlServerIn(Schema):
    kind: str = Field(default="iridi", max_length=16)
    protocol: str = Field(default="http", max_length=8)
    host: str = Field(max_length=255)
    port: int = 1085
    auth: str = Field(default="none", max_length=8)
    login: str = Field(default="", max_length=128)
    # Пусто — оставить сохранённый секрет как есть («изменить» — ввести новый).
    secret: str | None = Field(default=None, max_length=512)
    timeout_ms: int = 3000
    is_enabled: bool = True
    node_id: str | None = None


class RoomCheckIn(Schema):
    room_id: str


def _chain(hotel) -> dict:
    """Звенья цепочки: облако — коннектор — сервер управления — номера."""
    from apps.core.context import tenant_context
    from apps.grms.models import PublishedConfig, RoomTypeRoom
    from apps.grms.services import control_server, liveness
    from apps.hotels.models import HotelModule, OnPremNode, Room
    from apps.hotels.services.onprem import GRMS_PURPOSES, link_state, pick_node

    with tenant_context(hotel):
        nodes = list(OnPremNode.objects.filter(is_revoked=False, purpose__in=GRMS_PURPOSES).order_by("name"))
        room_control = HotelModule.objects.filter(code=HotelModule.Code.ROOM_CONTROL, is_enabled=True).exists()
        rooms = Room.objects.filter(is_active=True).count()
        published = set(PublishedConfig.objects.filter(is_current=True).values_list("room_type_id", flat=True))
        bound = RoomTypeRoom.objects.filter(room__is_active=True).count()
        ready = RoomTypeRoom.objects.filter(room__is_active=True, room_type_id__in=published).count()
    node = pick_node(nodes)
    link = link_state(nodes)
    server = control_server.get(hotel)
    source = control_server.source_of(hotel.pk)
    reachable = liveness.endpoint_reachable(hotel.pk) if link == "online" else None
    return {
        "room_control": room_control,
        "connector": {
            "state": "none" if node is None else ("online" if link == "online" else ("never" if node.last_seen_at is None else "silent")),
            "id": str(node.pk) if node else None,
            "name": node.name if node else None,
            "version": node.version if node else None,
            "seconds": node.seconds_since_seen if node else None,
        },
        "server_link": {
            "state": "unknown" if link != "online" else ("ok" if reachable else "down" if reachable is False else "unknown"),
            "source": (source or {}).get("source"),
            "configured": server is not None,
        },
        "rooms": {"total": rooms, "bound": bound, "ready": ready},
        "nodes": [
            {"id": str(n.pk), "name": n.name, "online": n.is_online, "version": n.version, "never": n.last_seen_at is None}
            for n in nodes
        ],
        "connector_url": hotel.public_guest_url("/ws/v1/onprem/connector").replace("https://", "wss://").replace("http://", "ws://"),
    }


@router.get("/hotels/{hotel_id}/control-server", summary="Сервер управления и цепочка подключения")
@requires(READ)
def control_server_get(request: HttpRequest, hotel_id: str):
    from apps.grms.services import control_server

    hotel = console.get_hotel(hotel_id)
    return {"server": control_server.serialize(control_server.get(hotel)), **_chain(hotel)}


@router.put("/hotels/{hotel_id}/control-server", summary="Задать сервер управления отеля")
@requires(WRITE)
def control_server_put(request: HttpRequest, hotel_id: str, payload: ControlServerIn):
    from apps.grms.services import control_server

    hotel = console.get_hotel(hotel_id)
    control_server.save(hotel, payload.dict(), actor_id=request.user.pk, ip=request.META.get("REMOTE_ADDR"))
    return {"server": control_server.serialize(control_server.get(hotel)), **_chain(hotel)}


@router.delete("/hotels/{hotel_id}/control-server", summary="Убрать адрес из Control: коннектор — по своему файлу")
@requires(WRITE)
def control_server_delete(request: HttpRequest, hotel_id: str):
    from apps.grms.services import control_server

    hotel = console.get_hotel(hotel_id)
    control_server.remove(hotel, actor_id=request.user.pk, ip=request.META.get("REMOTE_ADDR"))
    return {"server": None, **_chain(hotel)}


@router.post("/hotels/{hotel_id}/control-server/check", summary="Проверить связь с сервером управления (без команд)")
# Проверка ничего не меняет в отеле, но шлёт запрос на объект: POST — правом правки.
@requires(WRITE)
def control_server_check(request: HttpRequest, hotel_id: str):
    from apps.grms.services import control_server

    hotel = console.get_hotel(hotel_id)
    result = control_server.check(hotel)
    return {"check": result, "server": control_server.serialize(control_server.get(hotel)), **_chain(hotel)}


@router.post("/hotels/{hotel_id}/control-server/room-check", summary="Прочитать состояние номера (только чтение)")
@requires(WRITE)
def control_server_room_check(request: HttpRequest, hotel_id: str, payload: RoomCheckIn):
    from apps.core.errors import NotFoundError
    from apps.grms.services import control_server

    try:
        uuid.UUID(payload.room_id)
    except ValueError:
        raise NotFoundError("Номер не найден") from None
    return control_server.read_room(console.get_hotel(hotel_id), payload.room_id)
