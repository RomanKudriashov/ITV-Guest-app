"""
Реестр модулей отеля: чтение/запись включённых фич.

В R1 — только данные + API. Управляющий UI — R6, гейтинг CMS-навигации — R4
(для него служит `enabled_module_codes`). Именно этот реестр решает, что отель
видит в своей CMS: без модуля отель не видит ни одного его экрана.

Тариф (`Hotel.tariff`) — шов биллинга: сам по себе лишь пометка уровня; какие
модули включены — строки HotelModule (по тарифу или точечным исключением).
"""

from __future__ import annotations

from apps.core.context import tenant_context
from apps.hotels.models import HotelModule
from apps.hotels.vocabularies import MODULE_LABELS

# Полный набор известных кодов модулей — реестр всегда отдаёт их все.
ALL_CODES = [code.value for code in HotelModule.Code]
_VALID_SOURCES = {HotelModule.Source.TARIFF, HotelModule.Source.OVERRIDE}


def _serialize(module: HotelModule) -> dict:
    return {
        "code": module.code,
        "title": MODULE_LABELS.get(module.code, {}),
        "is_enabled": module.is_enabled,
        "source": module.source,
        "config": module.config or {},
    }


def _default_entry(code: str) -> dict:
    return {
        "code": code,
        "title": MODULE_LABELS.get(code, {}),
        "is_enabled": False,
        "source": HotelModule.Source.TARIFF.value,
        "config": {},
    }


def list_modules(hotel) -> list[dict]:
    """Полный реестр отеля: все известные модули — включённые и нет."""
    with tenant_context(hotel):
        existing = {module.code: module for module in HotelModule.objects.all()}
    return [
        _serialize(existing[code]) if code in existing else _default_entry(code)
        for code in ALL_CODES
    ]


def set_modules(hotel, entries: list[dict]) -> list[dict]:
    """
    Upsert строк реестра по коду. Неизвестные коды игнорируем.

    ИСТОЧНИК вычисляется здесь, а не приходит от клиента. Признак «выдано вне
    тарифа» — это ответ на вопрос «даёт ли текущий тариф этот модуль», и знает
    его только сервер: тарифная сетка объявлена в apps/hotels/tariffs.py.
    Позволив клиенту прислать source, мы получили бы второй источник правды —
    ровно то расхождение UI с моделью, от которого этот реестр и защищает.
    """
    from apps.hotels import tariffs

    granted = tariffs.modules_for(hotel.tariff)
    valid_codes = set(ALL_CODES)
    with tenant_context(hotel):
        for entry in entries:
            code = entry.get("code")
            if code not in valid_codes:
                continue
            enabled = bool(entry.get("is_enabled", False))
            source = (
                HotelModule.Source.OVERRIDE.value
                if enabled and code not in granted
                else HotelModule.Source.TARIFF.value
            )
            HotelModule.objects.update_or_create(
                code=code,
                defaults={
                    "is_enabled": enabled,
                    "source": source,
                    "config": entry.get("config") or {},
                },
            )
    return list_modules(hotel)


def enabled_module_codes(hotel) -> set[str]:
    """Коды включённых модулей — опора гейтинга CMS-навигации (R4)."""
    with tenant_context(hotel):
        return set(HotelModule.objects.filter(is_enabled=True).values_list("code", flat=True))
