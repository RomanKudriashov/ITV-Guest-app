"""Сборка эндпоинтов чата: гостевой тред и треды персонала."""

from __future__ import annotations

from .guest import thread as guest_thread
from .staff import threads as staff_threads

guest_router = guest_thread.router
staff_router = staff_threads.router

__all__ = ["guest_router", "staff_router"]
