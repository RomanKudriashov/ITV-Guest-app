"""
Автоперевод в CMS: охват, прогон, отчёт, расход.

ЧЕСТНОСТЬ ВАЖНЕЕ КНОПКИ. Пока модель не подключена, запуск отвечает отказом с
прямым текстом, а не делает вид, что перевёл. Охват при этом работает
по-настоящему и уже приносит пользу.
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.accounts.services.roles import require_hotel_admin
from apps.core.context import current_actor
from apps.core.errors import ConflictError
from apps.core.listing import envelope
from apps.hotels.services.hotel import current_hotel

from apps.translate.providers import get_provider
from apps.translate.schemas import RunIn
from apps.translate.services import reports
from apps.translate.services.coverage import coverage
from apps.translate.services.runner import queue_run, serialize_run

router = Router(tags=["cms:translate"])


@router.get("/translate/coverage", summary="Охват перевода по языкам")
def get_coverage(request: HttpRequest, languages: str = "", groups: str = ""):
    """«Английский: 12 из 70 позиций». Считается по живым данным отеля."""
    require_hotel_admin()
    hotel = current_hotel()
    asked = [code.strip() for code in languages.split(",") if code.strip()]
    wanted = [code.strip() for code in groups.split(",") if code.strip()]
    provider = get_provider()
    return {
        "source_language": hotel.default_language or "ru",
        "languages": coverage(asked or reports.target_languages(hotel), groups=wanted or None, hotel=hotel),
        "groups": reports.groups(),
        "provider": {"name": provider.name, "connected": provider.connected},
    }


@router.post("/translate/runs", summary="Запустить автоперевод")
def start_run(request: HttpRequest, payload: RunIn):
    """
    БЕЗ МОДЕЛИ НЕ ЗАПУСКАЕМ ВООБЩЕ. Пустой прогон, который «всё пропустил»,
    выглядел бы как поломка; отказ с причиной понятен сразу.
    """
    require_hotel_admin()
    hotel = current_hotel()
    provider = get_provider()
    if not provider.connected:
        raise ConflictError("Автоперевод пока не подключён", code="translation_not_connected")
    languages = payload.languages or reports.target_languages(hotel)
    run = queue_run(languages=languages, groups=payload.groups, user=current_actor())
    return serialize_run(run)


@router.get("/translate/runs", summary="Прогоны автоперевода")
def list_runs(request: HttpRequest):
    require_hotel_admin()
    rows = reports.recent_runs()
    return envelope(rows, total=len(rows), limit=len(rows))


@router.get("/translate/runs/{run_id}", summary="Отчёт прогона")
def get_run(request: HttpRequest, run_id: str):
    require_hotel_admin()
    return reports.run_report(run_id)


@router.get("/translate/usage", summary="Расход автоперевода по месяцам")
def get_usage(request: HttpRequest):
    """
    Расход отеля отдельной строкой: без него один большой каталог съест бюджет
    флота, и узнают об этом по счёту.
    """
    require_hotel_admin()
    rows = reports.usage_rows()
    return envelope(rows, total=len(rows), limit=len(rows))
