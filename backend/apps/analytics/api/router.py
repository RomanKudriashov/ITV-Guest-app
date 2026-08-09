"""Сборка эндпоинтов аналитики."""

from __future__ import annotations

from .cms import reports as cms_reports

cms_router = cms_reports.router

__all__ = ["cms_router"]
