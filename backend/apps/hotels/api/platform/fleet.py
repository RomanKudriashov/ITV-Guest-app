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

    return build_fleet(request.GET.dict(), request.user)


@router.get("/fleet/export", summary="Выгрузка флота в CSV")
@requires(READ)
def fleet_export(request: HttpRequest):
    from django.http import HttpResponse

    from apps.hotels.services.platform.fleet import export_csv

    body = export_csv(request.GET.dict(), request.user)
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
    """
    Адресация ДВУМЯ способами: перечнем отелей или группой.

    Группа — это первая настоящая проверка модели: у правила состав считается
    ПРЯМО СЕЙЧАС, тем же кодом, который показал число на экране. Хранимый
    состав дал бы «выключено 12» там, где отелей уже четырнадцать.
    """
    from apps.hotels.services.platform.fleet import bulk_set_active
    from apps.hotels.services.platform import groups as groups_svc

    ip = request.META.get("REMOTE_ADDR")

    group = None
    target_ids = list(payload.hotel_ids)
    if payload.group_id:
        group = groups_svc.get(payload.group_id)
        # Перечень и группа СКЛАДЫВАЮТСЯ, а не спорят: выбрать группу и добить
        # руками пару отелей — обычная работа, и запрещать её незачем.
        target_ids = list({*target_ids, *groups_svc.hotel_ids(group)})

    # ЦЕЛЬ ПЕРЕСЕКАЕТСЯ С ОБЛАСТЬЮ. Группа может быть шире, чем область
    # человека, и тогда действие применяется к пересечению — а не отвергается
    # целиком и не выполняется целиком.
    from apps.hotels.services.platform import scope

    target_ids, outside = scope.intersect(request.user, target_ids)
    changed = bulk_set_active(target_ids, payload.is_active)
    action = "activated" if payload.is_active else "deactivated"
    for hotel in changed:
        console.audit_hotel(hotel, f"platform.hotel.{action}", actor_id=request.user.pk, ip=ip, payload={"bulk": True})
    console.audit_platform(
        "platform.fleet.bulk",
        actor_id=request.user.pk,
        ip=ip,
        payload={
            "action": action,
            "requested": len(target_ids),
            "changed": len(changed),
            # Чем адресовали — в журнал: «выключено 12» без ответа «кого именно»
            # через неделю не восстановить, особенно если это было правило.
            "group": group.code if group else "",
            # Сколько цели осталось за областью: «выключено 12» без этого числа
            # у администратора группы читалось бы как «выключено всё».
            "outside_scope": outside,
        },
    )
    # Возвращаем СМЕНИВШИЕСЯ, а не запрошенные: «выключено 3 из 5» — честный
    # ответ, «выключено 5» при двух уже выключенных — нет.
    return {"changed": len(changed), "requested": len(target_ids), "outside_scope": outside}
