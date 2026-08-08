"""Он-прем узлы отелей: реестр, ключи, отзыв и перевыпуск."""

from __future__ import annotations

from typing import Any

from django.http import HttpRequest
from ninja import Router

from apps.core.errors import PermissionDenied
from apps.hotels.schemas.platform import NodeIn
from apps.hotels.services.platform import console

router = Router(tags=["platform"])


@router.get("/nodes", summary="Реестр он-прем узлов по всем отелям")
def list_nodes(request: HttpRequest):
    from apps.hotels.services.onprem import all_nodes

    return all_nodes()


@router.post("/hotels/{hotel_id}/nodes", response={201: dict}, summary="Завести узел и выдать ключ")
def create_node(request: HttpRequest, hotel_id: str, payload: NodeIn):
    from apps.accounts.platform_access import can_write
    from apps.hotels.services.onprem import register_node

    if not can_write(request.user):
        raise PermissionDenied("Роль «только чтение» не заводит узлы")
    hotel = console.get_hotel(hotel_id)
    node, key = register_node(hotel, name=payload.name, purpose=payload.purpose)
    console.audit_hotel(
        hotel,
        "platform.node.registered",
        actor_id=request.user.pk,
        ip=request.META.get("REMOTE_ADDR"),
        payload={"node": node.name, "purpose": node.purpose},
    )
    # Ключ показывается ОДИН раз: в базе лежит только его хэш.
    return 201, {"node": _node_row(node, hotel), "key": key}


@router.post("/nodes/{node_id}/revoke", summary="Отозвать ключ узла")
def revoke_node(request: HttpRequest, node_id: str):
    from apps.accounts.platform_access import can_write
    from apps.hotels.services.onprem import revoke_key

    if not can_write(request.user):
        raise PermissionDenied("Роль «только чтение» не отзывает ключи")
    node, hotel = revoke_key(node_id)
    console.audit_hotel(
        hotel, "platform.node.revoked", actor_id=request.user.pk,
        ip=request.META.get("REMOTE_ADDR"), payload={"node": node.name},
    )
    return _node_row(node, hotel)


@router.post("/nodes/{node_id}/reissue", summary="Перевыпустить ключ узла")
def reissue_node(request: HttpRequest, node_id: str):
    from apps.accounts.platform_access import can_write
    from apps.hotels.services.onprem import reissue_key

    if not can_write(request.user):
        raise PermissionDenied("Роль «только чтение» не выдаёт ключи")
    node, hotel, key = reissue_key(node_id)
    console.audit_hotel(
        hotel, "platform.node.reissued", actor_id=request.user.pk,
        ip=request.META.get("REMOTE_ADDR"), payload={"node": node.name},
    )
    return {"node": _node_row(node, hotel), "key": key}


def _node_row(node, hotel) -> dict[str, Any]:
    from apps.hotels.services.onprem import serialize_node

    return serialize_node(node, hotel)
