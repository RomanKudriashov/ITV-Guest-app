"""
CMS: включения сервисов (кросс-ссылки контента) — данные + API.

Полный управляющий UI (выбор источника/категорий/наценки/исполнителя) — R4;
здесь ручки, чтобы завести и править включение. Контракт — docs/inclusions-api-contract.md.
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router, Schema

from apps.catalog import inclusions as svc

router = Router(tags=["cms"])


class InclusionIn(Schema):
    source_service_id: str
    scope: str = "all"
    markup_kind: str = "none"
    markup_value: int = 0
    schedule_id: str | None = None
    executor: str = "source"
    is_active: bool = True
    sort_order: int = 0
    category_ids: list[str] = []
    hidden_item_ids: list[str] = []


class InclusionPatch(Schema):
    scope: str | None = None
    markup_kind: str | None = None
    markup_value: int | None = None
    schedule_id: str | None = None
    executor: str | None = None
    is_active: bool | None = None
    sort_order: int | None = None
    category_ids: list[str] | None = None
    hidden_item_ids: list[str] | None = None


@router.get("/services/{service_id}/inclusions", summary="Включения сервиса")
def list_inclusions(request: HttpRequest, service_id: str):
    return svc.list_inclusions(service_id)


@router.post(
    "/services/{service_id}/inclusions", response={201: dict}, summary="Создать включение"
)
def create_inclusion(request: HttpRequest, service_id: str, payload: InclusionIn):
    inclusion = svc.create_inclusion(service_id, payload.dict())
    return 201, svc.serialize_inclusion(inclusion)


@router.patch("/inclusions/{inclusion_id}", summary="Изменить включение")
def update_inclusion(request: HttpRequest, inclusion_id: str, payload: InclusionPatch):
    inclusion = svc.update_inclusion(inclusion_id, payload.dict(exclude_unset=True))
    return svc.serialize_inclusion(inclusion)


@router.delete("/inclusions/{inclusion_id}", summary="Удалить включение")
def delete_inclusion(request: HttpRequest, inclusion_id: str):
    svc.delete_inclusion(inclusion_id)
    return {"ok": True}
