"""Сборка эндпоинтов аккаунтов."""

from __future__ import annotations

from .cms import staff as cms_staff
from .staff import auth as staff_auth
from .staff import contacts as _staff_contacts  # noqa: F401 — регистрирует ручки на том же роутере

staff_router = staff_auth.router
cms_router = cms_staff.router

__all__ = ["cms_router", "staff_router"]
