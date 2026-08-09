"""Медиатека: оригиналы в MinIO, варианты режет Celery."""

from __future__ import annotations

from .asset import MediaAsset
from .placeholder import CategoryPlaceholder

__all__ = ["CategoryPlaceholder", "MediaAsset"]
