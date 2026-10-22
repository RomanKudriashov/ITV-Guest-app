"""Каталог модулей NaviRoom Control (партия 62-E1)."""

from __future__ import annotations

from django.http import HttpRequest

from apps.hotels.api.platform.rights import READ, PlatformRouter, requires

router = PlatformRouter(tags=["platform"])


@router.get("/modules", summary="Каталог модулей: состояние, подключение, сколько отелей")
@requires(READ)
def modules_catalog(request: HttpRequest):
    from apps.hotels.services.platform.modules_catalog import catalog

    return catalog(request.user)


@router.get("/modules/{code}", summary="Карточка модуля: отели и журнал включений")
@requires(READ)
def module_card(
    request: HttpRequest,
    code: str,
    state: str = "",
    search: str = "",
    cursor: str = "",
    limit: int = 50,
    sort: str = "",
    dir: str = "",
):
    from apps.hotels.services.platform.modules_catalog import module_card as build

    return build(
        code,
        {"state": state, "search": search, "cursor": cursor, "limit": limit, "sort": sort, "dir": dir},
        request.user,
    )
