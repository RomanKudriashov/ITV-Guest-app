"""
Включения сервисов: запись (с запретом циклов) и резолв эффективного каталога.

Модель — apps/catalog/models.py (ServiceInclusion + join'ы). Здесь: запрет
циклов, CRUD включений (C1) и резолвер эффективного меню/цены/доступности (C2).
Join-строки (выбранные категории, скрытые позиции) удаляем ЖЁСТКО
(`hard_delete`): soft-delete конфликтует с unique, как у ItemBadge.
"""

from __future__ import annotations

from django.db import transaction

from apps.core.errors import ConflictError, NotFoundError, ValidationError
from apps.hotels.models import Schedule, Service

from .models import (
    Category,
    Item,
    ServiceInclusion,
    ServiceInclusionCategory,
    ServiceInclusionHidden,
)


# --- Запрет циклов ----------------------------------------------------------


def would_create_cycle(including_service_id, source_service_id) -> bool:
    """
    Цикл, если источник (транзитивно) уже включает включающий сервис. Обходим
    граф «что включает сервис N» (inclusion.including_service=N → source_service).
    Самовключение — тоже цикл (плюс CheckConstraint в БД).
    """
    target = str(including_service_id)
    if target == str(source_service_id):
        return True
    seen: set[str] = set()
    frontier = [str(source_service_id)]
    while frontier:
        node = frontier.pop()
        if node in seen:
            continue
        seen.add(node)
        for src_id in ServiceInclusion.objects.filter(
            including_service_id=node, is_active=True
        ).values_list("source_service_id", flat=True):
            src = str(src_id)
            if src == target:
                return True
            frontier.append(src)
    return False


# --- CRUD -------------------------------------------------------------------


def _get_service(service_id) -> Service:
    service = Service.objects.filter(pk=service_id).first()
    if service is None:
        raise NotFoundError("Сервис не найден")
    return service


def _get_inclusion(inclusion_id) -> ServiceInclusion:
    inclusion = ServiceInclusion.objects.filter(pk=inclusion_id).first()
    if inclusion is None:
        raise NotFoundError("Включение не найдено")
    return inclusion


def _resolve_schedule(schedule_id):
    if not schedule_id:
        return None
    schedule = Schedule.objects.filter(pk=schedule_id).first()
    if schedule is None:
        raise ValidationError("Расписание не найдено", field="schedule_id")
    return schedule


def serialize_inclusion(inclusion: ServiceInclusion) -> dict:
    return {
        "id": str(inclusion.pk),
        "including_service_id": str(inclusion.including_service_id),
        "source_service_id": str(inclusion.source_service_id),
        "scope": inclusion.scope,
        "markup_kind": inclusion.markup_kind,
        "markup_value": inclusion.markup_value,
        "schedule_id": str(inclusion.schedule_id) if inclusion.schedule_id else None,
        "executor": inclusion.executor,
        "is_active": inclusion.is_active,
        "sort_order": inclusion.sort_order,
        "category_ids": [str(link.category_id) for link in inclusion.selected_categories.all()],
        "hidden_item_ids": [str(link.item_id) for link in inclusion.hidden_items.all()],
    }


def list_inclusions(service_id) -> list[dict]:
    _get_service(service_id)
    return [
        serialize_inclusion(inclusion)
        for inclusion in ServiceInclusion.objects.filter(including_service_id=service_id)
        .prefetch_related("selected_categories", "hidden_items")
        .order_by("sort_order", "id")
    ]


def _sync_categories(inclusion: ServiceInclusion, category_ids) -> None:
    inclusion.selected_categories.all().hard_delete()
    for category_id in category_ids or []:
        category = Category.objects.filter(pk=category_id).first()
        if category is None:
            raise ValidationError(f"Категория {category_id} не найдена", field="category_ids")
        ServiceInclusionCategory.objects.create(inclusion=inclusion, category=category)


def _sync_hidden(inclusion: ServiceInclusion, item_ids) -> None:
    inclusion.hidden_items.all().hard_delete()
    for item_id in item_ids or []:
        item = Item.objects.filter(pk=item_id).first()
        if item is None:
            raise ValidationError(f"Позиция {item_id} не найдена", field="hidden_item_ids")
        ServiceInclusionHidden.objects.create(inclusion=inclusion, item=item)


@transaction.atomic
def create_inclusion(service_id, data: dict) -> ServiceInclusion:
    including = _get_service(service_id)
    source_id = data.get("source_service_id")
    if not source_id:
        raise ValidationError("Нужен сервис-источник", field="source_service_id")
    source = _get_service(source_id)
    if would_create_cycle(including.pk, source.pk):
        raise ConflictError("Такое включение создаёт цикл", code="inclusion_cycle")
    inclusion = ServiceInclusion.objects.create(
        including_service=including,
        source_service=source,
        scope=data.get("scope", ServiceInclusion.Scope.ALL),
        markup_kind=data.get("markup_kind", ServiceInclusion.MarkupKind.NONE),
        markup_value=int(data.get("markup_value") or 0),
        schedule=_resolve_schedule(data.get("schedule_id")),
        executor=data.get("executor", ServiceInclusion.Executor.SOURCE),
        is_active=data.get("is_active", True),
        sort_order=int(data.get("sort_order") or 0),
    )
    _sync_categories(inclusion, data.get("category_ids"))
    _sync_hidden(inclusion, data.get("hidden_item_ids"))
    return inclusion


@transaction.atomic
def update_inclusion(inclusion_id, data: dict) -> ServiceInclusion:
    inclusion = _get_inclusion(inclusion_id)
    for attr in ("scope", "markup_kind", "executor"):
        if attr in data and data[attr] is not None:
            setattr(inclusion, attr, data[attr])
    if "markup_value" in data and data["markup_value"] is not None:
        inclusion.markup_value = int(data["markup_value"])
    if "schedule_id" in data:
        inclusion.schedule = _resolve_schedule(data["schedule_id"])
    if "is_active" in data and data["is_active"] is not None:
        inclusion.is_active = data["is_active"]
    if "sort_order" in data and data["sort_order"] is not None:
        inclusion.sort_order = int(data["sort_order"])
    inclusion.save()
    if "category_ids" in data:
        _sync_categories(inclusion, data["category_ids"])
    if "hidden_item_ids" in data:
        _sync_hidden(inclusion, data["hidden_item_ids"])
    return inclusion


@transaction.atomic
def delete_inclusion(inclusion_id) -> None:
    inclusion = _get_inclusion(inclusion_id)
    inclusion.selected_categories.all().hard_delete()
    inclusion.hidden_items.all().hard_delete()
    inclusion.delete(hard=True)
