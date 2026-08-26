"""
Он-прем узлы (Local Connector): регистрация, ключи, отметки «жив».

Ключ хранится ХЭШЕМ и показывается один раз. Причина не в формальности: этот
ключ открывает доступ к оборудованию в номерах живого отеля, и утечка дампа
таблицы не должна означать утечку доступа к чужим замкам и климату.

Отметка «жив» приходит от самого узла: облако не может достучаться до коробки
внутри сети отеля — за NAT её попросту нет снаружи. Поэтому направление связи
обратное, и «узел офлайн» здесь означает ровно «перестал отмечаться», а не
«мы не смогли до него дозвониться».
"""

from __future__ import annotations

import hashlib
import secrets

from django.utils import timezone

from apps.core.context import platform_scope, tenant_context
from apps.core.errors import NotFoundError, ValidationError
from apps.hotels.models import Hotel, OnPremNode

KEY_BYTES = 32


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def _new_key() -> tuple[str, str]:
    key = secrets.token_urlsafe(KEY_BYTES)
    return key, hash_key(key)


def register_node(hotel: Hotel, *, name: str, purpose: str) -> tuple[OnPremNode, str]:
    name = (name or "").strip()
    if not name:
        raise ValidationError("Нужно имя узла", field="name")
    if purpose not in OnPremNode.Purpose.values:
        raise ValidationError(f"Неизвестное назначение «{purpose}»", field="purpose")

    key, digest = _new_key()
    with tenant_context(hotel):
        if OnPremNode.objects.filter(name=name).exists():
            raise ValidationError(f"Узел «{name}» у этого отеля уже есть", field="name")
        node = OnPremNode.objects.create(
            name=name,
            purpose=purpose,
            key_hash=digest,
            key_issued_at=timezone.now(),
        )
    return node, key


def _find(node_id: str) -> tuple[OnPremNode, Hotel]:
    with platform_scope():
        node = (
            OnPremNode.all_objects.using("platform")
            .select_related("hotel")
            .filter(pk=node_id)
            .first()
        )
    if node is None:
        raise NotFoundError("Узел не найден")
    return node, node.hotel


def revoke_key(node_id: str) -> tuple[OnPremNode, Hotel]:
    """
    Отзыв ключа. Строку узла НЕ удаляем: платформе важно помнить, что у отеля
    был узел и когда его отключили, — иначе история «почему GRMS перестал
    работать» исчезает вместе со строкой.
    """
    node, hotel = _find(node_id)
    with tenant_context(hotel):
        OnPremNode.objects.filter(pk=node.pk).update(is_revoked=True, key_hash="")
    node.is_revoked = True
    node.key_hash = ""
    return node, hotel


def reissue_key(node_id: str) -> tuple[OnPremNode, Hotel, str]:
    node, hotel = _find(node_id)
    key, digest = _new_key()
    now = timezone.now()
    with tenant_context(hotel):
        OnPremNode.objects.filter(pk=node.pk).update(
            key_hash=digest, key_issued_at=now, is_revoked=False
        )
    node.key_hash, node.key_issued_at, node.is_revoked = digest, now, False
    return node, hotel, key


def touch(key: str, *, version: str = "") -> OnPremNode | None:
    """
    Отметка узла. Ищем по хэшу ключа поверх тенантов: узел знает свой ключ, но
    не знает идентификатора отеля в нашей базе — и не должен.
    """
    if not key:
        return None
    digest = hash_key(key)
    now = timezone.now()
    with platform_scope():
        node = (
            OnPremNode.all_objects.using("platform")
            .select_related("hotel")
            .filter(key_hash=digest, is_revoked=False)
            .first()
        )
        if node is None:
            return None
        OnPremNode.all_objects.using("platform").filter(pk=node.pk).update(
            last_seen_at=now, version=version or node.version
        )
    node.last_seen_at = now
    return node


def serialize_node(node: OnPremNode, hotel: Hotel) -> dict:
    return {
        "id": str(node.pk),
        "hotel": hotel.name_i18n,
        "hotel_id": str(hotel.pk),
        "subdomain": hotel.subdomain,
        "name": node.name,
        "purpose": node.purpose,
        "is_registered": node.is_registered,
        "is_online": node.is_online,
        "is_revoked": node.is_revoked,
        "seconds_since_seen": node.seconds_since_seen,
        "last_seen_at": node.last_seen_at.isoformat() if node.last_seen_at else None,
        "key_issued_at": node.key_issued_at.isoformat() if node.key_issued_at else None,
        "version": node.version,
    }


def all_nodes(*, limit: int | None = None, search: str = "", user=None) -> dict:
    """
    Реестр узлов поверх отелей — с пределом и честным хвостом.

    Узлов не бывает меньше, чем отелей с GRMS или PMS: на двухстах отелях это
    уже сотни строк, и выдача «всё, что нашлось» однажды упрётся в память
    браузера раньше, чем в базу.
    """
    from apps.hotels.services.platform.paging import clamp, envelope

    from apps.core.listing import search as apply_search

    limit = clamp(limit)
    with platform_scope():
        queryset = OnPremNode.all_objects.using("platform").select_related("hotel")
        # ОБЛАСТЬ: узел принадлежит отелю, и чужой узел в реестре — это чужой
        # отель в списке, только другими словами.
        from apps.hotels.services.platform import scope

        queryset = scope.limit_queryset(user, queryset, field="hotel_id")
        # Узел ищут по его коду и по поддомену отеля, которому он принадлежит.
        queryset = apply_search(queryset, search, ("name", "hotel__subdomain"))
        total = queryset.count()
        nodes = list(queryset.order_by("hotel__name", "name")[:limit])
    return envelope([serialize_node(node, node.hotel) for node in nodes], total, limit)
