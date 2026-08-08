"""CMS: заведения и услуги отеля — верхний уровень редактора."""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.core.schemas import OkOut
from apps.hotels.schemas.cms import ServiceIn, ServicePatch
from apps.hotels.services import admin_services as svc

router = Router(tags=["cms:hotel-admin"])


# ВНИМАНИЕ: статический `/services/templates` объявляется РАНЬШЕ
# параметризованного `/services/{id}` — иначе слово "templates" уедет в id.
@router.get("/services/templates", summary="Шаблоны для «+ добавить сервис»")
def cms_service_templates(request: HttpRequest):
    return svc.service_templates()


@router.get("/services", summary="Сервисы отеля (верхний уровень CMS)")
def cms_list_services(request: HttpRequest):
    return svc.list_services()


@router.post("/services", response={201: dict}, summary="Создать сервис из шаблона")
def cms_create_service(request: HttpRequest, payload: ServiceIn):
    service = svc.create_service(payload.dict(exclude_unset=True))
    return 201, svc.serialize_service(service)


@router.get("/services/{service_id}", summary="Сервис")
def cms_get_service(request: HttpRequest, service_id: str):
    return svc.serialize_service(svc.get_service(service_id))


@router.patch("/services/{service_id}", summary="Изменить сервис")
def cms_update_service(request: HttpRequest, service_id: str, payload: ServicePatch):
    return svc.serialize_service(svc.update_service(service_id, payload.dict(exclude_unset=True)))


@router.delete("/services/{service_id}", response=OkOut, summary="Удалить сервис")
def cms_delete_service(request: HttpRequest, service_id: str):
    svc.delete_service(service_id)
    return {"ok": True}
