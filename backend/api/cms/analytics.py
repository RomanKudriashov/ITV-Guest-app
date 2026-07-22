"""
CMS: аналитика отеля. Контракт — docs/analytics-api-contract.md.

Все эндпоинты читают предагрегаты; скоуп прав — внутри сервисов
(`scope_for(request.user)`), теми же привязками, что и трекер. Тенант-изоляция
сверх этого — RLS.
"""

from __future__ import annotations

from django.http import HttpRequest, HttpResponse
from ninja import Router, Schema

from apps.analytics import export as export_svc
from apps.analytics import queries
from apps.analytics.models import AnalyticsExport
from apps.analytics.scope import scope_payload
from apps.core.context import require_hotel_id
from apps.core.errors import NotFoundError
from apps.hotels.models import Hotel

router = Router(tags=["cms:analytics"])


def _hotel() -> Hotel:
    return Hotel.objects.get(pk=require_hotel_id())


def _params(request: HttpRequest) -> dict:
    # Плоский словарь query-параметров: последний выигрывает. Сервисы сами
    # знают, какие ключи им важны, — контроллер их не перечисляет.
    return {key: request.GET.get(key) for key in request.GET.keys()}


@router.get("/analytics/scope", summary="Что доступно пользователю")
def analytics_scope(request: HttpRequest):
    return scope_payload(request.user)


@router.get("/analytics/summary", summary="Карточки-итоги за период")
def analytics_summary(request: HttpRequest):
    return queries.summary(_hotel(), request.user, _params(request))


@router.get("/analytics/timeseries", summary="Динамика по времени")
def analytics_timeseries(request: HttpRequest):
    return queries.timeseries(_hotel(), request.user, _params(request))


@router.get("/analytics/breakdown", summary="Разбивка по измерению")
def analytics_breakdown(request: HttpRequest):
    return queries.breakdown(_hotel(), request.user, _params(request))


@router.get("/analytics/operations", summary="Операции: реакция/выполнение/отмены/эскалации")
def analytics_operations(request: HttpRequest):
    return queries.operations(_hotel(), request.user, _params(request))


@router.get("/analytics/traffic", summary="Трафик и конверсия")
def analytics_traffic(request: HttpRequest):
    return queries.traffic(_hotel(), request.user, _params(request))


@router.get("/analytics/reviews", summary="Отзывы: динамика и доля низких")
def analytics_reviews(request: HttpRequest):
    return queries.reviews(_hotel(), request.user, _params(request))


@router.get("/analytics/drilldown", summary="Список конкретных заявок среза")
def analytics_drilldown(request: HttpRequest):
    return queries.drilldown(_hotel(), request.user, _params(request))


# --- Экспорт ---------------------------------------------------------------


class ExportIn(Schema):
    kind: str = "breakdown"
    format: str = "csv"
    params: dict = {}


def _serialize_export(export: AnalyticsExport) -> dict:
    data = {
        "id": str(export.pk),
        "status": export.status,
        "kind": export.kind,
        "format": export.export_format,
        "row_count": export.row_count,
        "error": export.error,
    }
    if export.status == AnalyticsExport.Status.READY:
        # Витрина ждёт поле `file` — прямую ссылку на скачивание готового среза.
        data["file"] = f"/api/cms/analytics/export/{export.pk}/download"
        data["download_url"] = data["file"]
        data["filename"] = export.filename
    return data


@router.post("/analytics/export", summary="Поставить экспорт среза (Celery)")
def analytics_export_create(request: HttpRequest, payload: ExportIn):
    export = export_svc.create_export(
        require_hotel_id(),
        request.user,
        kind=payload.kind,
        export_format=payload.format,
        params=payload.params or {},
    )
    return _serialize_export(export)


@router.get("/analytics/export/{export_id}", summary="Статус экспорта")
def analytics_export_status(request: HttpRequest, export_id: str):
    export = AnalyticsExport.objects.filter(pk=export_id).first()
    if export is None:
        raise NotFoundError("Экспорт не найден")
    return _serialize_export(export)


@router.get("/analytics/export/{export_id}/download", summary="Скачать готовый файл")
def analytics_export_download(request: HttpRequest, export_id: str):
    export = AnalyticsExport.objects.filter(pk=export_id).first()
    if export is None or export.status != AnalyticsExport.Status.READY or export.content is None:
        raise NotFoundError("Файл ещё не готов")
    response = HttpResponse(bytes(export.content), content_type=export.content_type or "application/octet-stream")
    response["Content-Disposition"] = f'attachment; filename="{export.filename or "export"}"'
    return response
