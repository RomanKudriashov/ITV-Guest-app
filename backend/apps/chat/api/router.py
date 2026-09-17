"""Сборка эндпоинтов чата: гостевой тред и треды персонала."""

from __future__ import annotations

from .guest import thread as guest_thread
from .staff import desk as staff_desk
from .staff import threads as staff_threads

guest_router = guest_thread.router
staff_router = staff_threads.router
staff_router.add_router("", staff_desk.router)

__all__ = ["guest_router", "staff_router"]
