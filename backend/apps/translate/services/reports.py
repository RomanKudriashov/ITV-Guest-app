"""Чтение для CMS: языки отеля, прогоны, расход. Вьюха к базе не ходит."""

from __future__ import annotations

from apps.core.errors import NotFoundError
from apps.hotels.models import HotelLanguage

from apps.translate.fields import FIELDS
from apps.translate.models import TranslationRun, TranslationUsage
from apps.translate.services.runner import serialize_run

RUNS_SHOWN = 20
MONTHS_SHOWN = 24


def target_languages(hotel) -> list[str]:
    """Языки витрины, кроме языка отеля: на него переводить нечего."""
    codes = HotelLanguage.objects.filter(is_active=True).order_by("sort_order", "code")
    source = hotel.default_language or "ru"
    return [code for code in codes.values_list("code", flat=True) if code != source]


def groups() -> list[dict]:
    """Что вообще переводится — по группам, для подписи на экране."""
    seen: dict[str, list[str]] = {}
    for spec in FIELDS:
        seen.setdefault(spec.group, []).append(spec.title)
    return [{"group": name, "fields": titles} for name, titles in seen.items()]


def recent_runs() -> list[dict]:
    return [serialize_run(run) for run in TranslationRun.objects.all()[:RUNS_SHOWN]]


def run_report(run_id: str) -> dict:
    run = TranslationRun.objects.filter(pk=run_id).first()
    if run is None:
        raise NotFoundError("Прогон не найден")
    return serialize_run(run)


def usage_rows() -> list[dict]:
    return [
        {"period": row.period, "calls": row.calls, "characters": row.characters}
        for row in TranslationUsage.objects.order_by("-period")[:MONTHS_SHOWN]
    ]
