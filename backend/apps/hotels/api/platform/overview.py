"""Сводка по платформе и журнал её действий."""

from __future__ import annotations

from django.http import HttpRequest

from apps.hotels.api.platform.rights import READ, PlatformRouter, requires

router = PlatformRouter(tags=["platform"])


@router.get("/overview", summary="Сводка по платформе")
@requires(READ)
def overview(request: HttpRequest):
    from apps.hotels.services.platform.overview import build_overview

    return build_overview()


# --- Аудит платформы -------------------------------------------------------


@router.get("/audit", summary="Журнал действий платформы")
@requires(READ)
def platform_audit(
    request: HttpRequest,
    limit: int = 100,
    cursor: str | None = None,
    hotel_id: str | None = None,
    action: str | None = None,
    since: str | None = None,
    until: str | None = None,
):
    """
    Журнал листается КУРСОРОМ и фильтруется по дате, отелю и действию.

    Смещением листать нельзя: журнал пополняется во время просмотра, и вторая
    страница показала бы часть первой, пропустив столько же — ровно там и
    оказался бы разыскиваемый инцидент.

    Параметр называется `hotel_id`, а не `hotel`: имя `hotel` в строке запроса
    занято дев-переключателем тенанта (`TenantMiddleware`), и фильтр по отелю
    уводил запрос в несуществующий отель с ответом 404 «unknown_tenant».
    """
    from apps.hotels.services.platform.team import audit_feed

    return audit_feed(
        limit=limit, cursor=cursor, hotel_id=hotel_id, action=action, since=since, until=until
    )


@router.get("/audit/actions", summary="Виды действий для фильтра журнала")
@requires(READ)
def platform_audit_actions(request: HttpRequest):
    from apps.hotels.services.platform.team import audit_actions

    return audit_actions()
