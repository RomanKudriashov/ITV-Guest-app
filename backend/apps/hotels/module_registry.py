"""
Реестр модулей отеля (партия 62-E1: модули без тарифов).

Решения Олега (22.10.2026): тарифов нет, модули включаются руками, по одному.
Что включено — ровно `HotelModule.is_enabled`; тарифная сетка и «намерение»
модуля убраны из схемы (партия 62-E2).

ОДНО МЕСТО ПРАВДЫ про модуль — `MODULES` ниже: работает ли он уже или ещё в
разработке («заготовка»), без какого подключения он не работает, умолчания
настроек. Фронт берёт это отсюда (`GET /platform/modules`), а не держит свой
список: раньше «какие модули готовы» знал только экран Control.

ЗАГОТОВКУ ВКЛЮЧИТЬ НЕЛЬЗЯ — 409 `module_in_development`; выключить можно
(у отелей, где она была включена до 62-E1, её выключает миграция данных).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from apps.core.context import tenant_context
from apps.core.errors import ConflictError
from apps.hotels.models import HotelModule
from apps.hotels.vocabularies import MODULE_LABELS

READY = "ready"
DEV = "dev"


@dataclass(frozen=True)
class ModuleInfo:
    code: str
    status: str
    # Назначение коннектора, без которого модуль не работает (`OnPremNode.purpose`);
    # пусто — подключение не нужно. `kind` — для подписи на экране.
    needs: str = ""
    needs_purposes: tuple[str, ...] = ()
    # Настройки по умолчанию для нового включения (`HotelModule.config`).
    config_defaults: dict = field(default_factory=dict)


MODULES: dict[str, ModuleInfo] = {
    "room_control": ModuleInfo(
        "room_control", READY, needs="grms", needs_purposes=("grms", "both"),
        config_defaults={"guest_entry_demo": False},
    ),
    "marketing": ModuleInfo("marketing", READY),
    "pms": ModuleInfo("pms", DEV, needs="pms", needs_purposes=("pms", "both")),
    "payment": ModuleInfo("payment", DEV, needs="payments"),
    "mobile_key": ModuleInfo("mobile_key", DEV, needs="locks"),
    "native_app": ModuleInfo("native_app", DEV),
    "analytics_level": ModuleInfo("analytics_level", DEV),
    "multi_restaurant": ModuleInfo("multi_restaurant", DEV),
    "extra_languages": ModuleInfo("extra_languages", DEV),
}

# Полный набор известных кодов модулей — реестр всегда отдаёт их все.
ALL_CODES = [code.value for code in HotelModule.Code]
READY_CODES = [code for code in ALL_CODES if MODULES[code].status == READY]
DEV_CODES = [code for code in ALL_CODES if MODULES[code].status == DEV]

assert set(MODULES) == set(ALL_CODES), "реестр MODULES расходится с HotelModule.Code"


class ModuleInDevelopment(ConflictError):
    code = "module_in_development"


def info(code: str) -> ModuleInfo | None:
    return MODULES.get(code)


def is_ready(code: str) -> bool:
    item = MODULES.get(code)
    return bool(item and item.status == READY)


def describe(code: str) -> dict:
    """Что известно о модуле вне отеля: состояние, подключение, умолчания."""
    item = MODULES[code]
    return {
        "code": code,
        "title": MODULE_LABELS.get(code, {}),
        "status": item.status,
        "needs": item.needs,
        "config_defaults": dict(item.config_defaults),
    }


def _serialize(code: str, module: HotelModule | None) -> dict:
    return {
        **describe(code),
        "is_enabled": bool(module and module.is_enabled),
        "config": (module.config or {}) if module else {},
    }


def list_modules(hotel) -> list[dict]:
    """Полный реестр отеля: все известные модули — включённые и нет."""
    with tenant_context(hotel):
        existing = {module.code: module for module in HotelModule.objects.all()}
    return [_serialize(code, existing.get(code)) for code in ALL_CODES]


def check_can_enable(code: str) -> None:
    """Заготовку включить нельзя — ни руками, ни группой, ни шаблоном."""
    if code in MODULES and not is_ready(code):
        raise ModuleInDevelopment(
            "Модуль ещё в разработке — включить его нельзя",
            module=code,
        )


def set_module(hotel, code: str, enabled: bool, *, config: dict | None = None) -> tuple[bool, bool]:
    """
    Включить или выключить ОДИН модуль. Возвращает (было, стало).

    Другие модули не трогаются вовсе — прежний «весь список разом» ставил
    остальным «выключено вручную» одним щелчком (разведка Control, 19.10).
    """
    if code not in MODULES:
        from apps.core.errors import NotFoundError

        raise NotFoundError("Такого модуля нет")
    if enabled:
        check_can_enable(code)
    with tenant_context(hotel):
        module = HotelModule.objects.filter(code=code).first()
        before = bool(module and module.is_enabled)
        if module is None:
            if not enabled:
                return before, False
            HotelModule.objects.create(
                code=code,
                is_enabled=True,
                config={**MODULES[code].config_defaults, **(config or {})},
            )
            return before, True
        fields = []
        if module.is_enabled != enabled:
            module.is_enabled = enabled
            fields.append("is_enabled")
        if config:
            # Слияние, а не замена: в конфигурации управления номером лежит флаг
            # демо-входа, и чужая правка не должна его стирать.
            module.config = {**(module.config or {}), **config}
            fields.append("config")
        if fields:
            module.save(update_fields=[*fields, "updated_at"])
    return before, enabled


def set_modules(hotel, entries: list[dict]) -> list[dict]:
    """
    Несколько модулей разом — для внутренних путей (шаблон нового отеля,
    действие группы, сиды). Каждый — через `set_module`, со всеми его
    проверками; неизвестные коды пропускаются.
    """
    for entry in entries:
        code = entry.get("code")
        if code not in MODULES:
            continue
        set_module(hotel, code, bool(entry.get("is_enabled", False)), config=entry.get("config"))
    return list_modules(hotel)


def enabled_module_codes(hotel) -> set[str]:
    """Коды включённых модулей — опора гейтинга CMS-навигации (R4)."""
    with tenant_context(hotel):
        return set(HotelModule.objects.filter(is_enabled=True).values_list("code", flat=True))
