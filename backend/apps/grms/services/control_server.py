"""
СЕРВЕР УПРАВЛЕНИЯ ОТЕЛЯ ИЗ CONTROL (партия 63-3).

Адрес, порт, протокол, авторизация и таймаут сервера управления задаются в
Control и доезжают до коннектора отеля сообщением по его WS
(`connector.settings`). Коннектор принимает их только в пределах разрешённого
круга, заданного при установке на объекте, и отвечает, принял ли
(`connector.settings.result`) — это видно на экране «Подключения».

Не задан сервер в Control — коннектор работает по своему локальному файлу,
как до 63-3: облако отвечает ему `endpoints: null`.

НЕСКОЛЬКО ПОДКЛЮЧЕНИЙ (партия 65). У отеля может быть несколько серверов
управления, у каждого свой коннектор; номера назначаются подключениям, без
назначения — «по умолчанию». Коннектор получает настройки ТОЛЬКО своего
подключения (`links.server_for_node`), отклики и источник адреса считаются по
коннектору, а не по отелю. Функции без `server_id` работают с подключением
«по умолчанию» — экраны и вызовы до партии 65 не меняются.

Секрет (пароль, токен) хранится зашифрованным (`apps.grms.vault`) и
расшифровывается ровно в одном месте — `settings_message`, для коннектора.
Наружу (API, журнал, логи) — только «задан / не задан» и «изменён».
"""

from __future__ import annotations

import base64
import ipaddress
import logging
import re
from typing import Any

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.core.cache import cache
from django.db import transaction
from django.utils import timezone

from apps.core.context import tenant_context
from apps.core.errors import DomainError, NotFoundError, ValidationError
from apps.grms import vault
from apps.grms.models import ControlServer
from apps.grms.transport import adapter

logger = logging.getLogger(__name__)

READY_KINDS = (ControlServer.Kind.IRIDI,)
HOST_RE = re.compile(r"^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$")
CHECK_TTL_MS = 6000


class KindSoon(DomainError):
    status = 422
    code = "control_server_kind_soon"


# --- Чтение ------------------------------------------------------------------


def get(hotel, server_id=None) -> ControlServer | None:
    """Подключение по id; без id — «по умолчанию»."""
    from apps.grms.services import links

    with tenant_context(hotel):
        if server_id:
            server = ControlServer.objects.select_related("node").filter(pk=server_id).first()
            if server is None:
                raise NotFoundError("Подключение не найдено")
            return server
        return links.default_server()


def list_servers(hotel) -> list[ControlServer]:
    from apps.grms.services import links

    with tenant_context(hotel):
        return links.servers()


def _source_key(hotel_id) -> str:
    return f"grms:settings-source:{hotel_id}"


def remember_source(hotel_id, settings: dict | None) -> None:
    """Откуда у коннектора адрес — из heartbeat: «задан в Control» или «в файле на объекте»."""
    if isinstance(settings, dict) and settings.get("source") in ("control", "local"):
        from apps.grms.services.liveness import ENDPOINTS_TTL_S

        cache.set(_source_key(hotel_id), {"source": settings["source"], "revision": int(settings.get("revision") or 0)}, ENDPOINTS_TTL_S)


def source_of(hotel_id) -> dict | None:
    value = cache.get(_source_key(hotel_id))
    return value if isinstance(value, dict) else None


def serialize(server: ControlServer | None) -> dict[str, Any] | None:
    if server is None:
        return None
    return {
        "id": str(server.pk),
        "name": server.name,
        "label": server.label,
        "is_default": server.is_default,
        "kind": server.kind,
        "protocol": server.protocol,
        "host": server.host,
        "port": server.port,
        "auth": server.auth,
        "login": server.login,
        # Сам секрет наружу не отдаётся никогда — только «задан ли».
        "has_secret": bool(server.secret_sealed),
        "timeout_ms": server.timeout_ms,
        "is_enabled": server.is_enabled,
        "node_id": str(server.node_id) if server.node_id else None,
        "node": server.node.name if server.node_id and server.node else None,
        "revision": server.revision,
        "applied_revision": server.applied_revision,
        "applied_at": server.applied_at.isoformat() if server.applied_at else None,
        "apply_error": server.apply_error or None,
        "apply_detail": server.apply_detail or None,
        "last_check_at": server.last_check_at.isoformat() if server.last_check_at else None,
        "last_check_ok": server.last_check_ok,
        "last_check_detail": server.last_check_detail or None,
    }


# --- Правка ------------------------------------------------------------------


def _clean(data: dict, current: ControlServer | None) -> dict:
    kind = str(data.get("kind") or ControlServer.Kind.IRIDI)
    if kind not in ControlServer.Kind.values:
        raise ValidationError("Неизвестный тип сервера", field="kind")
    if kind not in READY_KINDS:
        raise KindSoon("Этот тип сервера появится позже — пока доступен только iRidi", field="kind")
    host = str(data.get("host") or "").strip()
    if not host:
        raise ValidationError("Укажите адрес сервера в сети отеля", field="host")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        if not HOST_RE.match(host):
            raise ValidationError("Адрес — IP или имя сервера, без «http://» и пути", field="host") from None
    try:
        port = int(data.get("port") or 0)
    except (TypeError, ValueError):
        port = 0
    if not 1 <= port <= 65535:
        raise ValidationError("Порт — число от 1 до 65535", field="port")
    protocol = str(data.get("protocol") or ControlServer.Protocol.HTTP)
    if protocol not in ControlServer.Protocol.values:
        raise ValidationError("Протокол — HTTP или HTTPS", field="protocol")
    auth = str(data.get("auth") or ControlServer.Auth.NONE)
    if auth not in ControlServer.Auth.values:
        raise ValidationError("Неизвестный способ входа", field="auth")
    login = str(data.get("login") or "").strip()[:128]
    secret = data.get("secret")
    has_secret = bool(secret) or bool(current and current.secret_sealed and current.auth == auth)
    if auth == ControlServer.Auth.BASIC and not login:
        raise ValidationError("Укажите логин сервера", field="login")
    if auth != ControlServer.Auth.NONE and not has_secret:
        raise ValidationError("Укажите пароль" if auth == ControlServer.Auth.BASIC else "Укажите токен", field="secret")
    try:
        timeout = int(data.get("timeout_ms") or 3000)
    except (TypeError, ValueError):
        timeout = 0
    if not 500 <= timeout <= 30000:
        raise ValidationError("Ждать ответа — от 500 до 30 000 мс", field="timeout_ms")
    return {
        "kind": kind, "host": host, "port": port, "protocol": protocol, "auth": auth,
        "login": login if auth == ControlServer.Auth.BASIC else "",
        "secret": secret if isinstance(secret, str) else None,
        "timeout_ms": timeout,
        "is_enabled": bool(data.get("is_enabled", True)),
        "node_id": data.get("node_id") or None,
        "name": str(data.get("name") or "").strip()[:120],
    }


TRACKED = ("name", "kind", "protocol", "host", "port", "auth", "login", "timeout_ms", "is_enabled", "node")


def _snapshot(server: ControlServer | None) -> dict:
    if server is None:
        return {key: None for key in TRACKED}
    return {
        "name": server.name or None,
        "kind": server.kind, "protocol": server.protocol, "host": server.host, "port": server.port,
        "auth": server.auth, "login": server.login, "timeout_ms": server.timeout_ms,
        "is_enabled": server.is_enabled, "node": server.node.name if server.node_id and server.node else None,
    }


class NodeTaken(DomainError):
    status = 409
    code = "connector_has_connection"


def _free_node(exclude_id=None):
    """Коннектор отеля, ещё не занятый другим подключением (для нового подключения без явного выбора)."""
    from apps.hotels.models import OnPremNode
    from apps.hotels.services.onprem import GRMS_PURPOSES, pick_node

    taken = set(
        ControlServer.objects.exclude(pk=exclude_id).exclude(node__isnull=True).values_list("node_id", flat=True)
    )
    free = [n for n in OnPremNode.objects.filter(is_revoked=False, purpose__in=GRMS_PURPOSES) if n.pk not in taken]
    return pick_node(free)


@transaction.atomic
def save(hotel, data: dict, *, actor_id=None, ip: str | None = None, server_id=None, create: bool = False) -> ControlServer:
    """
    Сохранить подключение и отправить настройки коннектору.

    `server_id` — правка этого подключения; `create` — новое подключение;
    ни того ни другого — подключение «по умолчанию» (как до партии 65; нет
    ни одного — заводится первое, и оно становится «по умолчанию»).
    """
    from apps.grms.services import links
    from apps.hotels.models import OnPremNode
    from apps.hotels.services.onprem import GRMS_PURPOSES, hotel_node
    from apps.hotels.services.platform import console

    with tenant_context(hotel):
        if create:
            current = None
        elif server_id:
            current = ControlServer.objects.select_related("node").filter(pk=server_id).first()
            if current is None:
                raise NotFoundError("Подключение не найдено")
        else:
            current = links.default_server()
        first = not ControlServer.objects.exists()
        before = _snapshot(current)
        clean = _clean(data, current)
        node = None
        if clean["node_id"]:
            node = OnPremNode.objects.filter(pk=clean["node_id"], is_revoked=False, purpose__in=GRMS_PURPOSES).first()
            if node is None:
                raise NotFoundError("Коннектор не найден или отозван")
        elif current is not None and current.node_id:
            node = current.node
        else:
            node = hotel_node() if first else _free_node(exclude_id=current.pk if current else None)
        if node is not None:
            other = ControlServer.objects.exclude(pk=current.pk if current else None).filter(node=node).first()
            if other is not None:
                raise NodeTaken(
                    f"Коннектор «{node.name}» уже ведёт подключение «{other.label}». Выберите другой коннектор.",
                    field="node_id",
                )
        server = current or ControlServer(hotel_id=hotel.pk, is_default=first)
        secret_changed = False
        for field in ("name", "kind", "host", "port", "protocol", "auth", "login", "timeout_ms", "is_enabled"):
            setattr(server, field, clean[field])
        server.node = node
        if clean["auth"] == ControlServer.Auth.NONE:
            secret_changed = bool(server.secret_sealed)
            server.secret_sealed = ""
        elif clean["secret"]:
            server.secret_sealed = vault.seal(clean["secret"])
            secret_changed = True
        after = _snapshot(server)
        changes = {f"control_{k}": {"from": before[k], "to": after[k]} for k in TRACKED if before[k] != after[k]}
        if secret_changed:
            # Секрет в журнал не пишется — только сам факт.
            changes["control_secret"] = {"from": None, "to": "changed"}
        if current is not None and not changes:
            return server
        server.revision = (server.revision or 0) + (1 if current is not None else 0)
        server.apply_error = ""
        server.apply_detail = ""
        server.save()
    console.audit_hotel(
        hotel,
        "platform.hotel.control_server_set",
        actor_id=actor_id,
        ip=ip,
        payload={"changes": changes, "connection": server.label},
    )
    transaction.on_commit(lambda: push(hotel))
    return server


@transaction.atomic
def set_default(hotel, server_id, *, actor_id=None, ip: str | None = None) -> ControlServer:
    """Сделать подключение «по умолчанию»: через него пойдут номера без своего назначения."""
    from apps.hotels.services.platform import console

    with tenant_context(hotel):
        server = ControlServer.objects.select_related("node").filter(pk=server_id).first()
        if server is None:
            raise NotFoundError("Подключение не найдено")
        previous = ControlServer.objects.filter(is_default=True).exclude(pk=server.pk).first()
        if previous is None and server.is_default:
            return server
        ControlServer.objects.filter(is_default=True).exclude(pk=server.pk).update(is_default=False)
        server.is_default = True
        server.save(update_fields=["is_default", "updated_at"])
    console.audit_hotel(
        hotel,
        "platform.hotel.control_server_default",
        actor_id=actor_id,
        ip=ip,
        payload={"changes": {"control_default": {"from": previous.label if previous else None, "to": server.label}}},
    )
    transaction.on_commit(lambda: push(hotel))
    return server


@transaction.atomic
def assign_rooms(hotel, server_id, room_ids, *, actor_id=None, ip: str | None = None, audit: bool = True) -> int:
    """
    Назначить номерам подключение. `server_id` пустой — вернуть номера на
    подключение «по умолчанию» (снять своё назначение). Возвращает, у скольких
    номеров назначение изменилось.
    """
    from apps.grms.models import RoomConnection
    from apps.hotels.models import Room
    from apps.hotels.services.platform import console

    with tenant_context(hotel):
        server = None
        if server_id:
            server = ControlServer.objects.select_related("node").filter(pk=server_id).first()
            if server is None:
                raise NotFoundError("Подключение не найдено")
        rooms = list(Room.objects.filter(pk__in=list(room_ids)))
        # all_objects: мягко удалённая связь тоже держит OneToOne по номеру —
        # её убираем насовсем, иначе новая не встанет.
        current = {str(r.room_id): r for r in RoomConnection.all_objects.filter(room__in=rooms)}
        changed = []
        for room in rooms:
            link = current.get(str(room.pk))
            alive = link is not None and link.deleted_at is None
            if server is None:
                if alive:
                    changed.append(room.number)
                if link is not None:
                    link.delete(hard=True)
                continue
            if alive and link.server_id == server.pk:
                continue
            if link is not None:
                link.delete(hard=True)
            RoomConnection.objects.create(hotel_id=hotel.pk, room=room, server=server)
            changed.append(room.number)
    if changed and audit:
        console.audit_hotel(
            hotel,
            "platform.hotel.rooms_connection_set",
            actor_id=actor_id,
            ip=ip,
            payload={"rooms": changed[:200], "count": len(changed), "connection": server.label if server else "по умолчанию"},
        )
    return len(changed)


def remove(hotel, *, actor_id=None, ip: str | None = None, server_id=None) -> None:
    """
    Убрать подключение. Его номера возвращаются на подключение «по умолчанию»;
    убрали «по умолчанию» — им становится следующее. Последнее подключение
    убрано — коннектор вернётся к локальному файлу, как до 63-3.
    """
    from apps.grms.models import RoomConnection
    from apps.grms.services import links
    from apps.hotels.services.platform import console

    with tenant_context(hotel):
        if server_id:
            server = ControlServer.objects.select_related("node").filter(pk=server_id).first()
            if server is None:
                raise NotFoundError("Подключение не найдено")
        else:
            server = links.default_server()
        if server is None:
            return
        before = _snapshot(server)
        # Номера подключения возвращаются на «по умолчанию»: их назначения — насовсем.
        RoomConnection.all_objects.filter(server=server).hard_delete()
        was_default = server.is_default
        server.is_default = False
        server.save(update_fields=["is_default", "updated_at"])
        server.delete()
        if was_default:
            heir = ControlServer.objects.order_by("created_at").first()
            if heir is not None:
                heir.is_default = True
                heir.save(update_fields=["is_default", "updated_at"])
    console.audit_hotel(
        hotel,
        "platform.hotel.control_server_removed",
        actor_id=actor_id,
        ip=ip,
        payload={"changes": {f"control_{k}": {"from": before[k], "to": None} for k in ("host", "port") if before[k] is not None}},
    )
    push(hotel)


# --- Коннектор ---------------------------------------------------------------


def _headers(server: ControlServer) -> dict[str, str]:
    secret = vault.unseal(server.secret_sealed)
    if server.auth == ControlServer.Auth.BASIC and secret:
        token = base64.b64encode(f"{server.login}:{secret}".encode("utf-8")).decode("ascii")
        return {"Authorization": f"Basic {token}"}
    if server.auth == ControlServer.Auth.TOKEN and secret:
        return {"Authorization": f"Bearer {secret}"}
    return {}


def _node_and_hotel(node_id):
    """Коннектор по id поверх тенантов — тем же путём, что `onprem.touch`: коннектор знает себя, а не отель."""
    from apps.hotels.models import OnPremNode
    from apps.core.context import platform_scope

    with platform_scope():
        node = OnPremNode.all_objects.using("platform").select_related("hotel").filter(pk=node_id).first()
    return (node, node.hotel) if node is not None else (None, None)


def server_for_node_id(node_id) -> tuple[Any, ControlServer | None]:
    """Отель коннектора и подключение, которое он ведёт (партия 65)."""
    from apps.grms.services import links

    node, hotel = _node_and_hotel(node_id)
    if node is None:
        return None, None
    with tenant_context(hotel):
        return hotel, links.server_for_node(node)


def settings_message(node_id) -> dict[str, Any]:
    """
    Настройки для коннектора — ЕДИНСТВЕННОЕ место, где секрет расшифровывается.
    Сервер не задан, выключен или тип ещё «скоро» — `endpoints: null`:
    коннектор работает по своему файлу.

    Только подключение ЭТОГО коннектора (партия 65): чужой адрес коннектор не
    получает, даже если он у того же отеля.
    """
    hotel, server = server_for_node_id(node_id)
    if hotel is None:
        return {"type": "connector.settings", "revision": 0, "endpoints": None}
    if server is None or not server.is_enabled or server.kind not in READY_KINDS:
        return {"type": "connector.settings", "revision": server.revision if server else 0, "endpoints": None}
    return {
        "type": "connector.settings",
        "revision": server.revision,
        "endpoints": {
            adapter.ENDPOINT_IRIDI: {
                "baseUrl": server.base_url,
                "timeoutMs": server.timeout_ms,
                "headers": _headers(server),
            }
        },
    }


def record_result(node_id, result: dict) -> None:
    """Ответ коннектора на настройки: принял ли и какую правку (его подключение)."""
    # Откуда адрес — сразу из ответа, не ждать heartbeat (до 30 с).
    remember_source(node_id, {"source": result.get("source"), "revision": result.get("revision")})
    hotel, server = server_for_node_id(node_id)
    if hotel is None or server is None:
        return
    with tenant_context(hotel):
        revision = int(result.get("revision") or 0)
        if revision and revision != server.revision:
            return  # ответ на прежнюю правку — уже не новость
        if result.get("ok"):
            server.applied_revision = revision or server.revision
            server.applied_at = timezone.now()
            server.apply_error = ""
            server.apply_detail = ""
        else:
            server.apply_error = str(result.get("reason") or "rejected")[:32]
            server.apply_detail = str(result.get("address") or result.get("endpoint") or "")[:255]
        server.save(update_fields=["applied_revision", "applied_at", "apply_error", "apply_detail", "updated_at"])


def push(hotel) -> None:
    """Отправить настройки всем коннекторам отеля, что сейчас на связи."""
    from apps.grms.consumers import group_name

    layer = get_channel_layer()
    if layer is None:
        return
    try:
        async_to_sync(layer.group_send)(group_name(hotel.pk), {"type": "connector.settings.push"})
    except Exception:  # шина недоступна — коннектор спросит настройки сам при переподключении
        logger.warning("не удалось отправить настройки сервера управления коннектору отеля %s", hotel.pk, exc_info=True)


# --- Проверки ----------------------------------------------------------------


def check(hotel, server_id=None) -> dict[str, Any]:
    """
    «Проверить сейчас»: коннектор открывает соединение с сервером управления —
    ни одной команды оборудованию. Подключение — указанное, иначе «по умолчанию».
    """
    from apps.grms.services import links
    from apps.grms.transport import transport

    server = get(hotel, server_id)
    with tenant_context(hotel):
        node = links.node_for_server(server)
    envelope = {"type": "connector.check", "requestID": adapter.new_request_id(), "endpoint": adapter.ENDPOINT_IRIDI, "ttl_ms": CHECK_TTL_MS}
    response = transport.send(hotel, envelope, ttl_ms=CHECK_TTL_MS, node=node) if node is not None else transport._offline(envelope["requestID"])
    result: dict[str, Any]
    if not response.get("ok"):
        code = (response.get("error") or {}).get("code") or "unknown"
        result = {"connector": code != adapter.CONNECTOR_OFFLINE, "reachable": False, "error": code}
    else:
        probe = response.get("check") or {}
        result = {
            "connector": True,
            "reachable": bool(probe.get("reachable")),
            "latency_ms": probe.get("latency_ms"),
            "address": probe.get("address"),
            "source": probe.get("source"),
            "version": probe.get("version"),
            "error": None if probe.get("reachable") else "server_unreachable",
        }
        if node is not None:
            remember_source(node.pk, {"source": probe.get("source")})
    with tenant_context(hotel):
        if server is not None:
            server.last_check_at = timezone.now()
            server.last_check_ok = bool(result.get("reachable"))
            server.last_check_detail = str(result.get("error") or "")[:255]
            server.save(update_fields=["last_check_at", "last_check_ok", "last_check_detail", "updated_at"])
    from apps.grms.services import liveness

    if result["connector"] and node is not None:
        liveness.observe(node.pk, bool(result["reachable"]))
    return result


def read_room(hotel, room_id) -> dict[str, Any]:
    """
    Проверка номера в мастере: ПРОЧИТАТЬ состояние, без единой команды SET.
    Номер без варианта или без опубликованной схемы — понятная причина.
    """
    from apps.grms.services import commands
    from apps.grms.services.guest import resolve_context_for_room

    context, reason = resolve_context_for_room(hotel, room_id)
    if context is None:
        return {"ok": False, "reason": reason or "no_type", "device": None, "read": 0, "answered": 0, "values": {}}
    feedbacks = sorted(
        {
            channel.get("feedback")
            for control in context.controls
            for channel in (control.get("channels") or {}).values()
            if channel.get("feedback")
        }
    )[:12]
    if not feedbacks:
        return {"ok": False, "reason": "no_feedback", "device": context.device, "read": 0, "answered": 0, "values": {}}
    results = commands.read_many(
        hotel,
        device=context.device,
        feedbacks=feedbacks,
        subdevice=context.payload.get("subdevice") or "",
        room=context.room.number,
    )
    answered = {name: result.value for name, result in results.items() if result.ok}
    return {
        "ok": bool(answered),
        "reason": "" if answered else "no_answer",
        "device": context.device,
        "read": len(feedbacks),
        "answered": len(answered),
        "values": {k: (v if isinstance(v, (int, float, str, bool)) or v is None else str(v)) for k, v in answered.items()},
    }


# --- Цепочка звеньев для Control (вынесено из API: ORM — в сервисах) -------


def _connection_rooms(server) -> set:
    """id номеров подключения: назначенные явно, а у «по умолчанию» — ещё и все без назначения."""
    from apps.grms.models import RoomConnection
    from apps.hotels.models import Room

    active = set(Room.objects.filter(is_active=True).values_list("pk", flat=True))
    if server is None:
        return active
    explicit = dict(RoomConnection.objects.filter(room_id__in=active).values_list("room_id", "server_id"))
    if server.is_default:
        return {rid for rid in active if explicit.get(rid, server.pk) == server.pk}
    return {rid for rid, sid in explicit.items() if sid == server.pk}


def chain(hotel, server=None) -> dict:
    """
    Звенья цепочки ОДНОГО подключения: облако — коннектор — сервер управления —
    номера. Без подключения — «по умолчанию» (как до партии 65).
    """
    from apps.core.context import tenant_context
    from apps.grms.models import PublishedConfig, RoomTypeRoom
    from apps.grms.services import links, liveness
    from apps.hotels.models import HotelModule, OnPremNode
    from apps.hotels.services.onprem import GRMS_PURPOSES

    with tenant_context(hotel):
        nodes = list(OnPremNode.objects.filter(is_revoked=False, purpose__in=GRMS_PURPOSES).order_by("name"))
        room_control = HotelModule.objects.filter(code=HotelModule.Code.ROOM_CONTROL, is_enabled=True).exists()
        if server is None:
            server = links.default_server()
        node = links.node_for_server(server)
        room_ids = _connection_rooms(server)
        rooms = len(room_ids)
        published = set(PublishedConfig.objects.filter(is_current=True).values_list("room_type_id", flat=True))
        bound = RoomTypeRoom.objects.filter(room_id__in=room_ids).count()
        ready = RoomTypeRoom.objects.filter(room_id__in=room_ids, room_type_id__in=published).count()
        taken = {str(s.node_id): s.label for s in links.servers() if s.node_id and (server is None or s.pk != server.pk)}
    link = "none" if node is None else ("online" if node.is_online else "silent")
    source = source_of(node.pk) if node is not None else None
    reachable = liveness.endpoint_reachable(node.pk) if link == "online" else None
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
            {
                "id": str(n.pk), "name": n.name, "online": n.is_online, "version": n.version, "never": n.last_seen_at is None,
                # Коннектор уже ведёт другое подключение (партия 65): у одного
                # коннектора одно подключение.
                "taken_by": taken.get(str(n.pk)),
            }
            for n in nodes
        ],
        "connection_id": str(server.pk) if server is not None else None,
        "connector_url": hotel.public_guest_url("/ws/v1/onprem/connector").replace("https://", "wss://").replace("http://", "ws://"),
    }


def summary(hotel, server) -> dict:
    """Подключение для списка: имя, звенья, сколько номеров."""
    links_ = chain(hotel, server)
    return {
        **serialize(server),
        "connector": links_["connector"],
        "server_link": links_["server_link"],
        "rooms": links_["rooms"],
    }
