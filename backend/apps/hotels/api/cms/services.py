"""CMS: заведения и услуги отеля — верхний уровень редактора."""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.core.schemas import OkOut
from apps.hotels.schemas.cms import ServiceIn, ServicePatch, SlaResetIn
from apps.hotels.services import admin_services as svc

router = Router(tags=["cms:hotel-admin"])


# ВНИМАНИЕ: статический `/services/templates` объявляется РАНЬШЕ
# параметризованного `/services/{id}` — иначе слово "templates" уедет в id.
@router.get("/services/templates", summary="Шаблоны для «+ добавить сервис»")
def cms_service_templates(request: HttpRequest):
    return svc.service_templates()


@router.get("/services", summary="Сервисы отеля (верхний уровень CMS)")
def cms_list_services(
    request: HttpRequest, search: str = "", limit: int | None = None, offset: int = 0
):
    return svc.list_services(search=search, limit=limit, offset=offset)


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


@router.get("/services/sla-overrides", summary="Где порог просрочки переопределён")
def cms_sla_overrides(request: HttpRequest):
    """
    Наследование порога работало и без этой ручки — не работал вид сверху.

    Порог красит заказы просрочкой, просрочка поднимает эскалацию, эскалация
    будит старшего. Точка с порогом в пять минут, поставленным когда-то на
    время, разбудит его сегодня ночью, и никто не вспомнит, что он там стоит.
    """
    from apps.hotels.services import sla_inheritance

    return sla_inheritance.report()


@router.post("/services/sla-overrides/reset", summary="Вернуть точки к умолчанию вида работы")
def cms_sla_overrides_reset(request: HttpRequest, payload: SlaResetIn):
    from apps.hotels.services import sla_inheritance

    return {"changed": sla_inheritance.reset(payload.point_ids)}
