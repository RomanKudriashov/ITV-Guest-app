"""Реестр отелей: поиск, выгрузка, массовые операции."""

from __future__ import annotations

from django.http import HttpRequest

from apps.hotels.api.platform.rights import OWNER, PUBLIC, READ, WRITE, PlatformRouter, requires
from apps.hotels.schemas.platform import BulkActiveIn
from apps.hotels.services.platform import console

router = PlatformRouter(tags=["platform"])


@router.get("/fleet", summary="Реестр отелей: поиск, фильтры, сортировка, страницы")
@requires(READ)
def fleet(request: HttpRequest):
    from apps.hotels.services.platform.fleet import fleet as build_fleet

    return build_fleet(request.GET.dict())


@router.get("/fleet/export", summary="Выгрузка флота в CSV")
@requires(READ)
def fleet_export(request: HttpRequest):
    from django.http import HttpResponse

    from apps.hotels.services.platform.fleet import export_csv

    body = export_csv(request.GET.dict())
    console.audit_platform(
        "platform.fleet.exported",
        actor_id=request.user.pk,
        ip=request.META.get("REMOTE_ADDR"),
        payload={"bytes": len(body)},
    )
    response = HttpResponse(body, content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = 'attachment; filename="fleet.csv"'
    return response


@router.post("/fleet/bulk", summary="Массово включить/выключить отели")
@requires(WRITE)
def fleet_bulk(request: HttpRequest, payload: BulkActiveIn):
    from apps.hotels.services.platform.fleet import bulk_set_active

    ip = request.META.get("REMOTE_ADDR")
    changed = bulk_set_active(payload.hotel_ids, payload.is_active)
    action = "activated" if payload.is_active else "deactivated"
    for hotel in changed:
        console.audit_hotel(hotel, f"platform.hotel.{action}", actor_id=request.user.pk, ip=ip, payload={"bulk": True})
    console.audit_platform(
        "platform.fleet.bulk",
        actor_id=request.user.pk,
        ip=ip,
        payload={"action": action, "requested": len(payload.hotel_ids), "changed": len(changed)},
    )
    # Возвращаем СМЕНИВШИЕСЯ, а не запрошенные: «выключено 3 из 5» — честный
    # ответ, «выключено 5» при двух уже выключенных — нет.
    return {"changed": len(changed), "requested": len(payload.hotel_ids)}
