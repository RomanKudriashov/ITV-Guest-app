"""Сборка эндпоинтов уведомлений."""

from __future__ import annotations

from .cms import settings as cms_settings

cms_router = cms_settings.router

__all__ = ["cms_router"]
