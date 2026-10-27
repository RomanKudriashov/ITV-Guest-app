"""
Подключение управления номером в Control (партия 63-3): сервер управления
отеля, цепочка звеньев, проверки. Правка — `WRITE`; у «только чтение» — 403.

НЕСКОЛЬКО ПОДКЛЮЧЕНИЙ (партия 65). Ручки `control-server*` принимают
`?connection=<id>`; без него работают с подключением «по умолчанию» — так, как
до партии 65. `?new=1` на PUT заводит новое подключение. Список —
`/connections`, назначение номеров — `/connections/assign`.
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
    name: str = Field(default="", max_length=120)


class ConnectionAssignIn(Schema):
    # Пусто — вернуть номера на подключение «по умолчанию».
    connection: str | None = None
    room_ids: list[str] = Field(default_factory=list, max_length=5000)


class RoomCheckIn(Schema):
    room_id: str


@router.get("/hotels/{hotel_id}/connections", summary="Подключения управления номером отеля")
@requires(READ)
def connections_list(request: HttpRequest, hotel_id: str):
    from apps.grms.services import control_server

    hotel = console.get_hotel(hotel_id)
    return {"items": [control_server.summary(hotel, server) for server in control_server.list_servers(hotel)]}


@router.post("/hotels/{hotel_id}/connections/{connection_id}/default", summary="Сделать подключение «по умолчанию»")
@requires(WRITE)
def connections_default(request: HttpRequest, hotel_id: str, connection_id: str):
    from apps.grms.services import control_server

    hotel = console.get_hotel(hotel_id)
    _valid_id(connection_id)
    control_server.set_default(hotel, connection_id, actor_id=request.user.pk, ip=request.META.get("REMOTE_ADDR"))
    return {"items": [control_server.summary(hotel, server) for server in control_server.list_servers(hotel)]}


@router.post("/hotels/{hotel_id}/connections/assign", summary="Назначить номерам подключение")
@requires(WRITE)
def connections_assign(request: HttpRequest, hotel_id: str, payload: ConnectionAssignIn):
    from apps.grms.services import control_server

    hotel = console.get_hotel(hotel_id)
    if payload.connection:
        _valid_id(payload.connection)
    for room_id in payload.room_ids:
        _valid_id(room_id)
    changed = control_server.assign_rooms(
        hotel, payload.connection, payload.room_ids, actor_id=request.user.pk, ip=request.META.get("REMOTE_ADDR")
    )
    return {"changed": changed, "items": [control_server.summary(hotel, server) for server in control_server.list_servers(hotel)]}


def _valid_id(value: str) -> None:
    from apps.core.errors import NotFoundError

    try:
        uuid.UUID(str(value))
    except ValueError:
        raise NotFoundError("Не найдено") from None


@router.get("/hotels/{hotel_id}/control-server", summary="Сервер управления и цепочка подключения")
@requires(READ)
def control_server_get(request: HttpRequest, hotel_id: str, connection: str | None = None):
    from apps.grms.services import control_server

    hotel = console.get_hotel(hotel_id)
    if connection:
        _valid_id(connection)
    server = control_server.get(hotel, connection)
    return {"server": control_server.serialize(server), **control_server.chain(hotel, server)}


@router.put("/hotels/{hotel_id}/control-server", summary="Задать сервер управления отеля")
@requires(WRITE)
def control_server_put(
    request: HttpRequest, hotel_id: str, payload: ControlServerIn, connection: str | None = None, new: bool = False
):
    from apps.grms.services import control_server

    hotel = console.get_hotel(hotel_id)
    if connection:
        _valid_id(connection)
    server = control_server.save(
        hotel, payload.dict(), actor_id=request.user.pk, ip=request.META.get("REMOTE_ADDR"),
        server_id=connection, create=new,
    )
    server = control_server.get(hotel, server.pk)
    return {"server": control_server.serialize(server), **control_server.chain(hotel, server)}


@router.delete("/hotels/{hotel_id}/control-server", summary="Убрать адрес из Control: коннектор — по своему файлу")
@requires(WRITE)
def control_server_delete(request: HttpRequest, hotel_id: str, connection: str | None = None):
    from apps.grms.services import control_server

    hotel = console.get_hotel(hotel_id)
    if connection:
        _valid_id(connection)
    control_server.remove(hotel, actor_id=request.user.pk, ip=request.META.get("REMOTE_ADDR"), server_id=connection)
    return {"server": None, **control_server.chain(hotel)}


@router.post("/hotels/{hotel_id}/control-server/check", summary="Проверить связь с сервером управления (без команд)")
# Проверка ничего не меняет в отеле, но шлёт запрос на объект: POST — правом правки.
@requires(WRITE)
def control_server_check(request: HttpRequest, hotel_id: str, connection: str | None = None):
    from apps.grms.services import control_server

    hotel = console.get_hotel(hotel_id)
    if connection:
        _valid_id(connection)
    result = control_server.check(hotel, connection)
    server = control_server.get(hotel, connection)
    return {"check": result, "server": control_server.serialize(server), **control_server.chain(hotel, server)}


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
