"""CMS: локации доставки и матрица «категория → локации»."""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.core.context import current_language
from apps.core.schemas import OkOut
from apps.hotels.schemas.cms import LocationIn, LocationPatch, MatrixRowIn
from apps.hotels.services import admin_services as svc

router = Router(tags=["cms:hotel-admin"])


@router.get("/locations", summary="Список локаций")
def list_locations(
    request: HttpRequest, search: str = "", limit: int | None = None, offset: int = 0
):
    return svc.list_locations(search=search, limit=limit, offset=offset)


@router.post("/locations", response={201: dict}, summary="Создать локацию")
def create_location(request: HttpRequest, payload: LocationIn):
    return 201, svc.serialize_location(svc.create_location(payload.dict()))


@router.get("/locations/matrix", summary="Матрица категория → локации")
def get_matrix(request: HttpRequest):
    return svc.location_matrix(current_language())


@router.put("/locations/matrix", summary="Обновить строку матрицы")
def put_matrix(request: HttpRequest, payload: MatrixRowIn):
    return svc.update_matrix_row(payload.category_id, [cell.dict() for cell in payload.cells])


@router.patch("/locations/{location_id}", summary="Изменить локацию")
def update_location(request: HttpRequest, location_id: str, payload: LocationPatch):
    return svc.serialize_location(svc.update_location(location_id, payload.dict(exclude_unset=True)))


@router.delete("/locations/{location_id}", response=OkOut, summary="Удалить локацию")
def delete_location(request: HttpRequest, location_id: str):
    svc.delete_location(location_id)
    return {"ok": True}
