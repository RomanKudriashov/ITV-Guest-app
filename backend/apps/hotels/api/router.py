"""Сборка эндпоинтов отеля: гостевой бренд, CMS, платформенная консоль."""

from __future__ import annotations

from .cms import router as cms_router
from .guest import hotel as guest_hotel
from .platform import router as platform_router

guest_router = guest_hotel.router

__all__ = ["cms_router", "guest_router", "platform_router"]
