"""
ПОДКЛЮЧЕНИЕ НОМЕРА (партия 65): через какой сервер управления и какой коннектор
идёт номер.

У отеля может быть несколько подключений (`ControlServer`): демо-номера — на
эмуляторе, номер 100 — на настоящем iRidi объекта. Номер назначается
подключению (`RoomConnection`); без назначения — подключение «по умолчанию».

Правило выбора — здесь и только здесь: транспорт, чтения, проверки и экраны
Control спрашивают этот модуль, а не решают каждый по-своему. Своя копия
правила в одном месте — это номер, который в карточке показан на одном
подключении, а команды шлёт в другое.

Вызывать под `tenant_context` отеля.
"""

from __future__ import annotations

from apps.grms.models import ControlServer, RoomConnection


def servers() -> list[ControlServer]:
    """Подключения отеля: «по умолчанию» первым, остальные по имени."""
    rows = list(ControlServer.objects.select_related("node").all())
    return sorted(rows, key=lambda s: (not s.is_default, s.label.lower(), str(s.pk)))


def default_server() -> ControlServer | None:
    """
    Подключение номеров без назначения.

    Если флаг ни у кого не стоит (отель завели до партии 65 и миграцию данных
    не прогнали), «по умолчанию» — единственное подключение: так отель с одним
    подключением работает, как работал.
    """
    rows = list(ControlServer.objects.select_related("node").all())
    flagged = [s for s in rows if s.is_default]
    if flagged:
        return flagged[0]
    return rows[0] if len(rows) == 1 else None


def assigned_server(room) -> ControlServer | None:
    """Подключение, назначенное номеру явно; `None` — номер «по умолчанию»."""
    link = RoomConnection.objects.select_related("server", "server__node").filter(room=room).first()
    return link.server if link is not None else None


def server_for_room(room) -> ControlServer | None:
    """Подключение номера: назначенное, иначе «по умолчанию»."""
    return assigned_server(room) or default_server()


def node_for_server(server: ControlServer | None):
    """
    Коннектор подключения. У подключения без своего коннектора (так заводили
    до партии 65) — главный коннектор отеля, как и раньше.
    """
    from apps.hotels.services.onprem import hotel_node

    if server is not None and server.node_id and server.node is not None and not server.node.is_revoked:
        return server.node
    return hotel_node()


def server_for_node(node) -> ControlServer | None:
    """
    Подключение, которое ведёт коннектор: закреплённое за ним, иначе
    «по умолчанию» без своего коннектора (прежняя схема — один коннектор на
    отель). Чужое подключение коннектор не получает никогда.
    """
    own = ControlServer.objects.select_related("node").filter(node=node).first()
    if own is not None:
        return own
    fallback = default_server()
    if fallback is not None and not fallback.node_id:
        return fallback
    return None


def room_by_number(number: str):
    from apps.hotels.models import Room

    return Room.objects.filter(number=str(number)).first() if number else None


def node_for_room(room=None, *, number: str = ""):
    """Коннектор, через который идут команды и чтения номера."""
    if room is None and number:
        room = room_by_number(number)
    server = server_for_room(room) if room is not None else default_server()
    return node_for_server(server)


def assignments(room_ids) -> dict[str, ControlServer]:
    """Явные назначения пачкой: id номера → подключение (для таблиц Control)."""
    rows = RoomConnection.objects.select_related("server", "server__node").filter(room_id__in=list(room_ids))
    return {str(row.room_id): row.server for row in rows}


def describe(server: ControlServer | None, *, explicit: bool) -> dict | None:
    """Подключение номера для экранов Control: имя и то, назначено ли явно."""
    if server is None:
        return None
    return {
        "id": str(server.pk),
        "name": server.label,
        "default": server.is_default,
        # `false` — номер на подключении «по умолчанию» без своего назначения.
        "explicit": explicit,
    }


def describe_room(room, *, explicit_map: dict | None = None, fallback: ControlServer | None = None) -> dict | None:
    """
    Подключение номера для экранов: явное либо «по умолчанию».

    С `explicit_map` (таблицы Control) база не трогается вовсе: назначения и
    «по умолчанию» собраны заранее под контекстом отеля. Без него — запросы,
    вызывать под `tenant_context`.
    """
    if explicit_map is not None:
        explicit = explicit_map.get(str(room.pk))
        return describe(explicit, explicit=True) if explicit is not None else describe(fallback, explicit=False)
    explicit = assigned_server(room)
    if explicit is not None:
        return describe(explicit, explicit=True)
    return describe(fallback if fallback is not None else default_server(), explicit=False)
