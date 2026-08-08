"""
CMS: дерево категорий и маршрут категории на исполнителя.

Вьюхи намеренно тонкие — разобрать запрос, позвать сервис, отдать результат.
Вся логика и валидация в apps/catalog/services/cms.py; доменные ошибки
превращает в HTTP общий обработчик (api/__init__.py).
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.catalog.schemas.cms import CategoryIn, CategoryPatch, CategoryTreeOut, RoutesIn
from apps.catalog.services import cms as svc
from apps.core.schemas import OkOut, ReorderIn, ToggleIn

router = Router(tags=["cms:catalog"])


@router.get("/categories", response=list[CategoryTreeOut], summary="Дерево категорий")
def list_categories(request: HttpRequest, type: str = "product", service_id: str = None):
    return svc.category_tree(type, service_id=service_id)


@router.post("/categories", response={201: CategoryTreeOut}, summary="Создать категорию")
def create_category(request: HttpRequest, payload: CategoryIn):
    category = svc.create_category(payload.dict(exclude_unset=True))
    return 201, svc.serialize_category(category, with_children=True)


# ВНИМАНИЕ: статические пути (`/reorder`) обязаны объявляться РАНЬШЕ
# параметризованных (`/{id}`) — Django резолвит URL по порядку регистрации, и
# `/categories/{category_id}` иначе перехватит слово "reorder" и вернёт 405.
@router.post(
    "/categories/reorder", response=list[CategoryTreeOut], summary="Сортировка категорий"
)
def reorder_categories(request: HttpRequest, payload: ReorderIn):
    return svc.reorder_categories([entry.dict() for entry in payload.items])


@router.get("/categories/{category_id}", response=CategoryTreeOut, summary="Категория")
def get_category(request: HttpRequest, category_id: str):
    return svc.serialize_category(svc.get_category(category_id), with_children=True)


@router.patch("/categories/{category_id}", response=CategoryTreeOut, summary="Изменить категорию")
def update_category(request: HttpRequest, category_id: str, payload: CategoryPatch):
    category = svc.update_category(category_id, payload.dict(exclude_unset=True))
    return svc.serialize_category(category, with_children=True)


@router.delete("/categories/{category_id}", response=OkOut, summary="Удалить категорию")
def delete_category(request: HttpRequest, category_id: str, cascade: bool = False):
    svc.delete_category(category_id, cascade=cascade)
    return {"ok": True}


@router.post(
    "/categories/{category_id}/toggle", response=CategoryTreeOut, summary="Вкл/выкл категорию"
)
def toggle_category(request: HttpRequest, category_id: str, payload: ToggleIn):
    category = svc.toggle_category(category_id, is_active=payload.is_active)
    return svc.serialize_category(category, with_children=True)


# --- Маршрутизация категории на исполнителя ----------------------------------


@router.get("/categories/{category_id}/routes", summary="Кто исполняет категорию")
def cms_category_routes(request: HttpRequest, category_id: str):
    return svc.category_routes(category_id)


@router.put("/categories/{category_id}/routes", summary="Назначить исполнителей категории")
def cms_replace_category_routes(request: HttpRequest, category_id: str, payload: RoutesIn):
    return svc.replace_category_routes(
        category_id, [entry.dict() for entry in payload.routes]
    )
