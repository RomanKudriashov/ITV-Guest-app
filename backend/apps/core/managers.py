"""
Менеджеры, которые делают скоуп по тенанту и soft-delete невидимыми для
прикладного кода. Правило проекта: `Model.objects` — это ВСЕГДА «живые строки
текущего отеля». Всё остальное требует явного намерения.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from .context import current_hotel_id, is_platform_scope


class SoftDeleteQuerySet(models.QuerySet):
    def delete(self):
        """Массовое удаление тоже мягкое — иначе soft-delete дырявый."""
        return super().update(deleted_at=timezone.now())

    def hard_delete(self):
        return super().delete()

    def alive(self):
        return self.filter(deleted_at__isnull=True)

    def dead(self):
        return self.filter(deleted_at__isnull=False)


class BaseManager(models.Manager.from_queryset(SoftDeleteQuerySet)):
    """Живые строки. Для нетенантных моделей."""

    def get_queryset(self):
        return super().get_queryset().filter(deleted_at__isnull=True)


class AllObjectsManager(models.Manager.from_queryset(SoftDeleteQuerySet)):
    """Всё как есть: и удалённые, и чужие. Для админки, миграций, отладки."""


class TenantManager(BaseManager):
    """
    Автоматический скоуп по текущему отелю.

    Fail-closed: вне контекста отеля и вне platform_scope() возвращается пустой
    queryset. Забытый фильтр не превращается в утечку между отелями — он
    превращается в пустую выдачу, которую видно сразу.
    """

    def get_queryset(self):
        queryset = super().get_queryset()
        hotel_id = current_hotel_id()
        if hotel_id is not None:
            return queryset.filter(hotel_id=hotel_id)
        if is_platform_scope():
            return queryset
        return queryset.none()
