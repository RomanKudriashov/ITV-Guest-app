"""
Сброс кэша готовности отеля при правке того, от чего зависят её правила.

Правило читает модули, коннекторы, номера, варианты, версии, PIN, сервисы с
меню и местами подачи, администраторов. Правка любого из них — новая картина,
и ждать минуту, пока кэш истечёт сам, значило бы показать оператору «проблема
есть» сразу после того, как он её исправил.

Массовые `.update()` сигналов не шлют — там, где готовность от них зависит
(ключи коннектора), сброс зовётся явно; остальное догоняет за минуту.
"""

from __future__ import annotations

from django.apps import apps
from django.db.models.signals import post_delete, post_save

# Модели, от которых зависят правила готовности.
WATCHED = (
    "hotels.HotelModule",
    "hotels.OnPremNode",
    "hotels.Room",
    "hotels.Service",
    "hotels.Location",
    "grms.RoomType",
    "grms.RoomTypeRoom",
    "grms.PublishedConfig",
    "grms.RoomPin",
    "catalog.Category",
    "catalog.Item",
    "catalog.ServiceLocation",
    "accounts.User",
)


def _reset(sender, instance, **kwargs) -> None:
    from apps.hotels.services.platform.readiness import invalidate

    invalidate(getattr(instance, "hotel_id", None))


def connect() -> None:
    for label in WATCHED:
        model = apps.get_model(label)
        post_save.connect(_reset, sender=model, dispatch_uid=f"readiness:{label}:save")
        post_delete.connect(_reset, sender=model, dispatch_uid=f"readiness:{label}:delete")
