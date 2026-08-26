"""Он-прем узлы отелей: реестр, ключи, отзыв и перевыпуск."""

from __future__ import annotations

from typing import Any

from django.http import HttpRequest

from apps.hotels.api.platform.rights import OWNER, PUBLIC, READ, WRITE, PlatformRouter, requires
from apps.hotels.schemas.platform import NodeIn
from apps.hotels.services.platform import console

router = PlatformRouter(tags=["platform"])


@router.get("/nodes", summary="Реестр он-прем узлов по всем отелям")
@requires(READ)
def list_nodes(request: HttpRequest, limit: int = 100, search: str = ""):
    from apps.hotels.services.onprem import all_nodes

    return all_nodes(limit=limit, search=search, user=request.user)


@router.post("/hotels/{hotel_id}/nodes", response={201: dict}, summary="Завести узел и выдать ключ")
@requires(WRITE)
def create_node(request: HttpRequest, hotel_id: str, payload: NodeIn):
    from apps.hotels.services.onprem import register_node

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
@requires(WRITE)
def revoke_node(request: HttpRequest, node_id: str):
    from apps.hotels.services.onprem import revoke_key

    node, hotel = revoke_key(node_id)
    console.audit_hotel(
        hotel, "platform.node.revoked", actor_id=request.user.pk,
        ip=request.META.get("REMOTE_ADDR"), payload={"node": node.name},
    )
    return _node_row(node, hotel)


@router.post("/nodes/{node_id}/reissue", summary="Перевыпустить ключ узла")
@requires(WRITE)
def reissue_node(request: HttpRequest, node_id: str):
    from apps.hotels.services.onprem import reissue_key

    node, hotel, key = reissue_key(node_id)
    console.audit_hotel(
        hotel, "platform.node.reissued", actor_id=request.user.pk,
        ip=request.META.get("REMOTE_ADDR"), payload={"node": node.name},
    )
    return {"node": _node_row(node, hotel), "key": key}


def _node_row(node, hotel) -> dict[str, Any]:
    from apps.hotels.services.onprem import serialize_node

    return serialize_node(node, hotel)
