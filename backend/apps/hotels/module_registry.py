"""
Реестр модулей отеля: чтение/запись включённых фич.

В R1 — только данные + API. Управляющий UI — R6, гейтинг CMS-навигации — R4
(для него служит `enabled_module_codes`). Именно этот реестр решает, что отель
видит в своей CMS: без модуля отель не видит ни одного его экрана.

Тариф (`Hotel.tariff`) — шов биллинга: сам по себе лишь пометка уровня; какие
модули включены — строки HotelModule (по тарифу или точечным исключением).

ДВА ФАКТА, А НЕ ОДИН. Что даёт тариф — знает тарифная сетка. Что решил человек
— знает `HotelModule.intent`. Включённость (`is_enabled`) это их СЛЕДСТВИЕ, и
пересчитывается она при смене любого из двух. Раньше следствие было
единственным, что хранилось, а «источник» вычислялся из него обратной формулой
— и не сходился: выключенный модуль всегда выглядел как «тариф не даёт», даже
если его выключили руками полчаса назад.
"""

from __future__ import annotations

from apps.core.context import tenant_context
from apps.hotels.models import HotelModule
from apps.hotels.vocabularies import MODULE_LABELS

# Полный набор известных кодов модулей — реестр всегда отдаёт их все.
ALL_CODES = [code.value for code in HotelModule.Code]


def resolve_enabled(intent: str, granted: bool) -> bool:
    """
    Что должно быть включено ПРИ ЭТОМ тарифе и ЭТОМ намерении.

    Ручное «выключено» сильнее тарифа: раз человек погасил модуль, новый тариф
    не должен зажигать его за спиной.

    Ручное «включено» тариф НЕ перебивает: выдача модуля сверх тарифа — это
    точечное исключение под конкретный тариф (пилот, демонстрация), и переезд
    на другой тариф — ровно тот момент, когда исключение пора пересмотреть.
    Поэтому при смене тарифа оно гаснет — но не молча: список гаснущих модулей
    показывается поимённо ДО нажатия и уходит в журнал после.
    """
    if intent == HotelModule.Intent.OFF:
        return False
    return granted


def _granted_codes(hotel) -> set[str]:
    from apps.hotels.services import tariffs

    return set(tariffs.modules_for(hotel.tariff))


def _serialize(module: HotelModule, granted: set[str]) -> dict:
    return {
        "code": module.code,
        "title": MODULE_LABELS.get(module.code, {}),
        "is_enabled": module.is_enabled,
        # Намерение и «даёт ли тариф» — два независимых факта, и экран обязан
        # показывать оба: из них складываются ЧЕТЫРЕ разных подписи, а не две.
        "intent": module.intent or "",
        "in_tariff": module.code in granted,
        # `source` остаётся в ответе тем, чем он всегда и был на деле —
        # вычисляемой пометкой «включено сверх тарифа». Хранить его перестали:
        # он никогда не был данными, только следствием.
        "source": (
            HotelModule.Source.OVERRIDE.value
            if module.is_enabled and module.code not in granted
            else HotelModule.Source.TARIFF.value
        ),
        "config": module.config or {},
    }


def _default_entry(code: str, granted: set[str]) -> dict:
    return {
        "code": code,
        "title": MODULE_LABELS.get(code, {}),
        "is_enabled": False,
        "intent": "",
        "in_tariff": code in granted,
        "source": HotelModule.Source.TARIFF.value,
        "config": {},
    }


def list_modules(hotel) -> list[dict]:
    """Полный реестр отеля: все известные модули — включённые и нет."""
    granted = _granted_codes(hotel)
    with tenant_context(hotel):
        existing = {module.code: module for module in HotelModule.objects.all()}
    return [
        _serialize(existing[code], granted) if code in existing else _default_entry(code, granted)
        for code in ALL_CODES
    ]


def set_modules(hotel, entries: list[dict]) -> list[dict]:
    """
    Upsert строк реестра по коду. Неизвестные коды игнорируем.

    ПРИШЕДШЕЕ ОТ КЛИЕНТА `is_enabled` — ЭТО НАМЕРЕНИЕ. Человек, двигающий
    тумблер в консоли, принимает решение, а не сообщает вычисленное значение;
    решение и записываем. Само включение — следствие намерения и тарифа, и
    считает его `resolve_enabled`, кроме одного случая: выдать модуль сверх
    тарифа можно только прямым действием, и здесь оно как раз происходит.

    `source` от клиента по-прежнему игнорируется — теперь просто потому, что
    такого поля больше нет.
    """
    granted = _granted_codes(hotel)
    valid_codes = set(ALL_CODES)
    with tenant_context(hotel):
        for entry in entries:
            code = entry.get("code")
            if code not in valid_codes:
                continue
            enabled = bool(entry.get("is_enabled", False))
            intent = HotelModule.Intent.ON if enabled else HotelModule.Intent.OFF
            # ЧАСТИЧНОЕ обновление, а не перезапись. Запрос без `config`
            # означает «настройки не трогать», а не «стереть их».
            #
            # Перезапись стоила ровно того, ради чего реестр и заводили:
            # в конфигурации модуля управления номером лежит флаг демо-входа,
            # и один заход в платформенную консоль — переключить любой другой
            # модуль — молча стирал его. Гость после этого упирался в PIN,
            # которого никто не знает, а связь с «мы тут галочку двигали»
            # обнаруживалась не сразу.
            module, created = HotelModule.objects.get_or_create(
                code=code,
                defaults={
                    "is_enabled": enabled,
                    "intent": intent,
                    "config": entry.get("config") or {},
                },
            )
            if created:
                continue
            module.is_enabled = enabled
            module.intent = intent
            if "config" in entry and entry["config"] is not None:
                # Слияние, а не замена: клиент присылает то, что меняет, и не
                # обязан знать про чужие ключи в той же конфигурации.
                module.config = {**(module.config or {}), **entry["config"]}
            module.save(update_fields=["is_enabled", "intent", "config", "updated_at"])
    return list_modules(hotel)


def modules_lost_on(hotel, next_tariff: str) -> list[str]:
    """
    Какие ВКЛЮЧЁННЫЕ сейчас модули погаснут на новом тарифе.

    Считается до записи и по той же формуле, что и сам пересчёт, — иначе
    предупреждение и действие разошлись бы, а именно этим прежняя реализация и
    была плоха: она предупреждала о том, чего не делала.
    """
    from apps.hotels.services import tariffs

    granted = set(tariffs.modules_for(next_tariff))
    with tenant_context(hotel):
        rows = list(HotelModule.objects.filter(is_enabled=True))
    return sorted(
        module.code for module in rows if not resolve_enabled(module.intent, module.code in granted)
    )


def apply_tariff(hotel) -> list[str]:
    """
    Пересчитать включённость по НЫНЕШНЕМУ тарифу отеля при неизменных
    намерениях. Возвращает коды модулей, которые погасли.

    Вызывается после смены тарифа. До этого смена тарифа не трогала реестр
    вообще: модули старого тарифа оставались включёнными и продолжали
    подписываться «по тарифу», модули нового не включались, а предупреждение
    «тариф не даёт модули X» оставалось словами — X как работал, так и работал.
    """
    granted = _granted_codes(hotel)
    turned_off: list[str] = []
    with tenant_context(hotel):
        existing = {module.code: module for module in HotelModule.objects.all()}
        for code in ALL_CODES:
            wanted = resolve_enabled(existing[code].intent if code in existing else "", code in granted)
            module = existing.get(code)
            if module is None:
                # Строки нет — заводим только то, что новый тариф ЗАЖИГАЕТ.
                # Плодить выключенные строки на каждый код незачем: реестр и
                # так отдаёт их все.
                if wanted:
                    HotelModule.objects.create(code=code, is_enabled=True, intent="")
                continue
            if module.is_enabled == wanted:
                continue
            if module.is_enabled and not wanted:
                turned_off.append(code)
            module.is_enabled = wanted
            module.save(update_fields=["is_enabled", "updated_at"])
    return sorted(turned_off)


def enabled_module_codes(hotel) -> set[str]:
    """Коды включённых модулей — опора гейтинга CMS-навигации (R4)."""
    with tenant_context(hotel):
        return set(HotelModule.objects.filter(is_enabled=True).values_list("code", flat=True))
