"""Сборка эндпоинтов чата: гостевой тред и треды персонала."""

from __future__ import annotations

from .guest import thread as guest_thread
from .cms import settings as cms_settings
from .staff import desk as staff_desk
from .staff import threads as staff_threads

guest_router = guest_thread.router
cms_router = cms_settings.router
staff_router = staff_threads.router
staff_router.add_router("", staff_desk.router)

__all__ = ["cms_router", "guest_router", "staff_router"]
