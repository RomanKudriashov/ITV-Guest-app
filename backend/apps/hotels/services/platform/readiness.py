"""
Готовность отеля: восемь правил «что мешает отелю работать» (партия 62-B).

Правила считает СЕРВЕР, а не экран: одно и то же число стоит в карточке
отеля, в строке «Отелей» и в сводке группы, и посчитанное в трёх местах
разошлось бы в трёх местах. Экран получает код правила, важность, вкладку
«исправить» и подробности числами — слова на четырёх языках у него свои.

Кэш — 60 с на отель (Redis). Правка, от которой зависит правило, сбрасывает
его сразу (`invalidate`, сигналы в `apps.hotels.signals`); то, что меняется
само по времени (коннектор замолчал, сутки неудачных команд), догоняет за
минуту — экран так и пишет: «обновляется раз в минуту».

Важность:
  bad  — гость уже сейчас чего-то не может;
  warn — требует внимания, скоро может стать красным;
  info — стоит проверить.
"""

from __future__ import annotations

from collections import Counter
from datetime import timedelta
from typing import Any

from django.core.cache import cache
from django.db.models import Q
from django.utils import timezone

from apps.core.context import tenant_context
from apps.hotels.models import Hotel
from apps.hotels.services.onprem import link_state, pick_node

CACHE_S = 60
FAILED_PER_DAY = 10

# Модуль → назначения коннектора, без которых он не работает — из реестра
# модулей (62-E1). Только готовые: заготовки ничего не делают и с подключением тоже.
def _module_needs() -> dict[str, tuple[str, ...]]:
    from apps.hotels.module_registry import MODULES, READY

    return {code: m.needs_purposes for code, m in MODULES.items() if m.status == READY and m.needs_purposes}

# Исходы обмена с оборудованием, которые гость видит как «сработало».
# «Не подтвердилось» сюда НЕ входит: команда ушла, а свет не включился.
GOOD_RESULTS = ("ok", "confirmed", "accepted")

# Правила по порядку чек-листа. Вкладка «исправить» — ключ вкладки карточки;
# `panel` — вход в панель отеля (заведения и меню правит отель там).
RULES: tuple[tuple[str, str, str], ...] = (
    ("module_without_connection", "bad", "connections"),
    ("connector_silent", "bad", "connections"),
    ("rooms_without_variant", "warn", "roomControl"),
    ("variant_unpublished", "warn", "roomControl"),
    ("failed_commands", "warn", "journal"),
    ("no_menu_service", "warn", "panel"),
    ("rooms_without_pin", "info", "rooms"),
    ("admin_never_logged_in", "warn", "profile"),
)
SEVERITY = {code: severity for code, severity, _ in RULES}
FIX = {code: fix for code, _, fix in RULES}
ROOM_RULES = {"rooms_without_variant", "variant_unpublished", "failed_commands", "rooms_without_pin"}
_ORDER = {"bad": 0, "warn": 1, "info": 2}


def _key(hotel_id) -> str:
    return f"readiness:{hotel_id}"


def invalidate(hotel_id) -> None:
    """Сбросить готовность отеля: следующая выдача посчитает заново."""
    if hotel_id:
        cache.delete(_key(hotel_id))


def readiness(hotel: Hotel, *, fresh: bool = False) -> dict[str, Any]:
    """Готовность отеля — из кэша, если он свежий."""
    if not fresh:
        cached = cache.get(_key(hotel.pk))
        if cached is not None:
            return cached
    result = compute(hotel)
    cache.set(_key(hotel.pk), result, CACHE_S)
    return result


def problem_count(hotel: Hotel) -> int:
    """Число проблем для строки «Отелей» и сводки группы. Отключённый — 0."""
    if not hotel.is_active:
        return 0
    return len(readiness(hotel)["problems"])


# --- Расчёт -------------------------------------------------------------------


def _problem(code: str, title: str, *, count: int = 1, key: str = "", **params) -> dict:
    return {
        "code": code,
        "key": f"{code}:{key}" if key else code,
        "severity": SEVERITY[code],
        "fix": FIX[code],
        "count": count,
        # Русская строка — для API и журналов; экран пишет своими словами по коду.
        "title": title,
        "params": params,
    }


def _needs_kind(code: str) -> str:
    from apps.hotels.module_registry import MODULES

    return MODULES[code].needs if code in MODULES else ""


def compute(hotel: Hotel) -> dict[str, Any]:
    from apps.accounts.models import User
    from apps.hotels.models import HotelModule, OnPremNode, Room

    now = timezone.now()
    problems: list[dict] = []
    skipped: set[str] = set()

    with tenant_context(hotel):
        modules = set(HotelModule.objects.filter(is_enabled=True).values_list("code", flat=True))
        nodes = list(OnPremNode.objects.filter(is_revoked=False).order_by("name"))
        rooms = Room.objects.filter(is_active=True)
        room_count = rooms.count()
        admins = list(User.objects.filter(is_hotel_admin=True, is_active=True).order_by("created_at"))
        staff = User.objects.filter(is_staff_member=True).count()

        # 1. Модуль включён, подключения нет.
        for code in sorted(modules):
            purposes = _module_needs().get(code)
            if purposes and not any(node.purpose in purposes for node in nodes):
                problems.append(_problem(
                    "module_without_connection",
                    f"Модуль «{code}» включён без подключения",
                    key=code, module=code, needs=_needs_kind(code),
                ))

        # 2. Коннектор молчит — когда НА СВЯЗИ НИ ОДНОГО узла (партия 62-F-хвост).
        # Лишний не подключавшийся узел рядом с живым проблемой не считается:
        # отель работает. Во вкладке «Подключения» он виден сам по себе.
        if not nodes:
            skipped.add("connector_silent")
        elif link_state(nodes) != "online":
            node = pick_node(nodes)
            seconds = node.seconds_since_seen
            problems.append(_problem(
                "connector_silent",
                f"Коннектор «{node.name}» не на связи",
                key=str(node.pk), node=node.name, seconds=seconds,
            ))

        room_control = "room_control" in modules
        bound = 0
        commands = {"total": 0, "failed": 0}
        if room_control:
            bound, commands = _room_rules(problems, rooms, now)
        else:
            skipped |= ROOM_RULES

        # 6. Нет сервиса с меню и местом подачи.
        services = _menu_services()
        if not services["ready"]:
            problems.append(_problem("no_menu_service", "Нет сервиса с меню и местом подачи"))

        # 8. Администратор ни разу не входил.
        if not admins:
            skipped.add("admin_never_logged_in")
        elif all(admin.last_login is None for admin in admins):
            problems.append(_problem(
                "admin_never_logged_in",
                "Администратор ни разу не входил",
                count=len(admins), emails=[admin.email for admin in admins],
            ))

    problems.sort(key=lambda p: _ORDER[p["severity"]])
    failing = {p["code"] for p in problems}
    # Карточка «Коннектор» — главный узел по общему правилу, а не первый по имени.
    node = pick_node(nodes)
    return {
        "checked_at": now.isoformat(),
        "problems": problems,
        "rules": [
            {
                "code": code,
                "severity": severity,
                "status": "fail" if code in failing else "skip" if code in skipped else "pass",
            }
            for code, severity, _ in RULES
        ],
        "facts": {
            "rooms": room_count,
            "rooms_bound": bound,
            "staff": staff,
            "admins": len(admins),
            "services": services["total"],
            "menu_services": services["ready"],
            "items": services["items"],
            "room_control": room_control,
            "connector": None if node is None else {
                "name": node.name,
                "online": node.is_online,
                "seconds": node.seconds_since_seen,
                "version": node.version,
            },
            "commands": commands,
        },
    }


def _room_rules(problems: list[dict], rooms, now) -> tuple[int, dict]:
    """Правила управления номером: варианты, версии, неудачные команды, PIN."""
    from apps.core.models import AuditLog
    from apps.grms.models import PublishedConfig, RoomPin, RoomType, RoomTypeRoom
    from apps.grms.services.diagnostics import ACTIONS

    bound_ids = set(
        RoomTypeRoom.objects.filter(room__in=rooms).values_list("room_id", flat=True)
    )
    # 3. Номера без варианта.
    free = rooms.exclude(pk__in=bound_ids).count()
    if free:
        problems.append(_problem(
            "rooms_without_variant", f"{free} номеров без варианта управления", count=free,
        ))

    # 4. Вариант без опубликованной версии. Пустой вариант никого не держит.
    current = set(PublishedConfig.objects.filter(is_current=True).values_list("room_type_id", flat=True))
    per_type = Counter(
        RoomTypeRoom.objects.filter(room_id__in=bound_ids).values_list("room_type_id", flat=True)
    )
    for room_type in RoomType.objects.filter(pk__in=per_type.keys()).order_by("code"):
        if room_type.pk not in current:
            title = room_type.title_i18n or room_type.code
            problems.append(_problem(
                "variant_unpublished",
                f"Вариант «{title}» не опубликован",
                key=room_type.code, variant=title, rooms=per_type[room_type.pk],
            ))

    # 5. Неудачные команды и чтения за сутки. Записи без итога (старые пакетные
    # чтения) не считаются ни удачными, ни неудачными — итога там нет.
    day = AuditLog.objects.filter(action__in=ACTIONS, created_at__gte=now - timedelta(days=1))
    with_result = day.filter(payload__has_key="result")
    total = with_result.count()
    failed_rows = with_result.exclude(payload__result__in=GOOD_RESULTS)
    failed = failed_rows.count()
    if failed >= FAILED_PER_DAY:
        sample = list(failed_rows.values_list("payload__result", "payload__room")[:500])
        reason, reason_count = Counter(str(r) for r, _ in sample).most_common(1)[0]
        rooms_hit = list(dict.fromkeys(str(room) for _, room in sample if room))[:5]
        problems.append(_problem(
            "failed_commands",
            f"{failed} неудачных обращений к оборудованию за сутки",
            count=failed, reason=reason, reason_count=reason_count, rooms=rooms_hit,
        ))

    # 7. Номера без PIN — среди тех, что управляются.
    with_pin = set(
        RoomPin.objects.filter(room_id__in=bound_ids)
        .exclude(pin_hash="")
        .filter(Q(valid_until__isnull=True) | Q(valid_until__gt=now))
        .values_list("room_id", flat=True)
    )
    no_pin = len(bound_ids - with_pin)
    if no_pin:
        problems.append(_problem(
            "rooms_without_pin", f"{no_pin} номеров без PIN", count=no_pin,
        ))
    return len(bound_ids), {"total": total, "failed": failed}


def _menu_services() -> dict[str, int]:
    """
    Сервисы, у которых гостю есть что заказать и куда получить.

    «Куда» — тем же правилом, что проверяет заказ (`locations._Rule`): иначе
    готовность сказала бы «всё есть», а заказ отказал бы местом подачи.
    """
    from apps.catalog.models import Category, Item
    from apps.hotels.models import Location, Service
    from apps.hotels.services.locations import _Rule

    services = Service.objects.filter(is_active=True)
    total = services.count()
    items = Item.objects.filter(is_active=True, category__service__in=services).count()
    candidates = services.filter(is_guest_facing=True, has_catalog=True, execution_point__is_active=True)
    categories = list(
        Category.objects.filter(
            service__in=candidates, is_active=True, is_internal=False,
            items__is_active=True, items__is_internal=False,
        )
        .values_list("pk", "service_id")
        .distinct()
    )
    locations = list(Location.objects.filter(is_active=True))
    ready: set = set()
    rule = _Rule({str(pk) for pk, _ in categories})
    for pk, service_id in categories:
        if service_id in ready:
            continue
        if any(rule._category_allows(str(pk), location) for location in locations):
            ready.add(service_id)
    return {"total": total, "ready": len(ready), "items": items}
