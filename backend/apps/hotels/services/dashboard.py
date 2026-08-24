"""
ДАШБОРД ОТЕЛЯ: пульт, а не справка.

Экран показывал три плитки — заказов сегодня, заведений на витрине, всего
сервисов — и плоский список сервисов с «2 сотр. · 8 позиций». Два числа из трёх
меняются раз в месяц, когда открывают новый бар, а «сотрудников и позиций» —
это содержимое справочника. Ни одно из них не требует действия, хотя подпись
экрана обещает «что происходит сейчас».

Экран отвечает на два вопроса управляющего — утренний и вечерний:

    что сломалось, пока меня не было;
    день идёт лучше или хуже вчерашнего.

Оба про РАЗНИЦУ, а не про уровень: «63 заказа» не говорит ничего, «63 против
35 вчера» говорит всё. Отсюда и порядок блоков: сначала «чините вот это», потом
«вот как идёт день», потом «вот где именно».

НИ ОДНОГО НОВОГО СЧЁТЧИКА. Всё собирается из того, что уже считается:

  «сейчас»      — `tracker_shift.shift_summary_for` (та же сводка, что у доски,
                  обобщённая на набор точек);
  «за сегодня»  — `analytics.queries.summary(preset=today, compare=previous)`
                  (роллапы пишутся живьём на каждое событие заказа, поэтому
                  «сегодня» свежее);
  тариф         — `platform.usage.usage_for`;
  эскалации     — `NotificationLog`.

СКОРОСТЬ — МЕДИАНА, А НЕ СРЕДНЕЕ. У аналитики есть `avg_fulfil_seconds`, и
соблазн взять его велик. Но дашборд про «сейчас», а среди активных заказов
всегда есть забытые, и одно такое значение утаскивает среднее в бессмыслицу.
Среднее остаётся в аналитике, где оно про ЗАКРЫТЫЙ период.

ЧЕГО ЗДЕСЬ НЕТ. Периодов, разрезов, выгрузок и графиков — это аналитика, и два
ответа на один вопрос хуже одного. Нулей вместо «не знаем» — тоже: блок, чьи
данные не приехали, отдаёт `None`, а экран печатает прочерк.
"""

from __future__ import annotations

from datetime import timedelta

from django.utils import timezone

from apps.analytics.services.queries import summary as analytics_summary
from apps.analytics.services.scope import scope_for
from apps.core.fields import translate
from apps.hotels.models import ExecutionPoint, Hotel, OnPremNode
from apps.orders.services.tracker_shift import shift_summary_for

# Сколько минут без запроса гость считается ушедшим. Пятнадцать: сессия живёт
# сутками, и «гостей в приложении» по ней означало бы «кто заходил за сутки», а
# это уже аналитика, а не пульт.
LIVE_SESSION_MINUTES = 15


def _points_in_scope(user) -> list[ExecutionPoint]:
    """
    Точки, за которые человек отвечает.

    Скоуп берём у аналитики, а не строим заново: правило «управляющий видит
    только то, чем УПРАВЛЯЕТ, а не то, где работает» уже записано там, и второе
    его изложение разошлось бы с первым.
    """
    scope = scope_for(user)
    points = ExecutionPoint.objects.filter(is_active=True).prefetch_related("services")
    if not scope.all_points:
        points = points.filter(pk__in=scope.point_ids or [])
    return list(points.order_by("code"))


def build(hotel: Hotel, user) -> dict:
    scope = scope_for(user)
    points = _points_in_scope(user)
    shift = shift_summary_for(points, hotel=hotel)

    return {
        "scope": {
            "all_points": scope.all_points,
            # Управляющему единственного заведения разрез «по заведениям» не
            # нужен: он и так весь экран.
            "points_count": len(points),
        },
        "attention": _attention(hotel, user, points, shift, scope),
        "today": _today(hotel, user, shift),
        "venues": _venues(hotel, points),
    }


# --- Требует внимания ------------------------------------------------------


def _attention(hotel, user, points, shift, scope) -> list[dict]:
    """
    Список того, что горит. КАЖДАЯ карточка появляется только при значении
    больше нуля: пять зелёных нулей — это не «всё хорошо», это пять строк,
    которые перестают читать. Всё в порядке — список пуст, и экран говорит об
    этом одной строкой.

    Порядок — по цене промедления: невзятый заказ и не дошедшее предупреждение
    стоят дороже, чем превышенный тариф.
    """
    cards: list[dict] = []

    if shift["overdue"]:
        cards.append(
            {
                "code": "overdue",
                "severity": "error",
                "count": shift["overdue"],
                # Куда идти чинить. Фильтр просрочки на доске уже есть.
                "route": "/tracker?overdue=1",
            }
        )

    fired, failed = _escalations(hotel, points)
    if failed:
        # ОПАСНЕЕ, ЧЕМ «НЕТ ЭСКАЛАЦИИ»: правило есть, оно сработало, а
        # сообщение не ушло. Отель при этом уверен, что его предупредят.
        cards.append(
            {"code": "delivery_failed", "severity": "error", "count": failed,
             "route": "/cms/notifications"}
        )
    if fired:
        cards.append(
            {"code": "escalated", "severity": "warning", "count": fired,
             "route": "/cms/notifications"}
        )

    without_rules = _services_without_escalation(points)
    if without_rules:
        # Та самая метка «Нет эскалации», которая висела в списке сервисов без
        # объяснения. Здесь у неё есть и причина, и адрес: невзятая заявка не
        # всплывёт ни у кого, и отель узнает о ней от гостя.
        cards.append(
            {"code": "no_escalation", "severity": "warning", "count": len(without_rules),
             "names": without_rules, "route": "/cms/notifications"}
        )

    stopped = _stop_list(points)
    if stopped:
        cards.append(
            {"code": "stop_list", "severity": "warning", "count": stopped,
             "route": "/cms/services"}
        )

    # ДАЛЬШЕ — ТОЛЬКО ДЛЯ АДМИНИСТРАТОРА ОТЕЛЯ.
    #
    # Управляющему заведением ни узел, ни тариф не подчинены: он не может ни
    # починить связь с оборудованием, ни сменить тариф. Тревога без адресата
    # хуже её отсутствия — человек видит красное и не знает, что делать.
    if scope.is_hotel_admin:
        offline = _offline_node(hotel)
        if offline is not None:
            cards.append(
                {"code": "node_offline", "severity": "error", "minutes": offline,
                 "route": "/cms/room-control"}
            )
        for row in _tariff_overage(hotel):
            cards.append(
                {"code": "tariff_over", "severity": "warning", "resource": row["key"],
                 "used": row["used"], "limit": row["limit"], "route": "/cms/settings"}
            )

    return cards


def _escalations(hotel, points) -> tuple[int, int]:
    """
    Сколько ступеней сработало и сколько отправок не дошло — за сутки отеля и
    ТОЛЬКО по точкам скоупа.

    Первая редакция считала по всему отелю, и управляющий баром видел «187
    эскалаций», из которых его касались две: чужие числа в его карточке — это
    не просто лишнее, это тревога, на которую он не может ответить.
    """
    from apps.notifications.models import NotificationLog

    since = hotel.local_now().replace(hour=0, minute=0, second=0, microsecond=0)
    rows = NotificationLog.objects.filter(
        created_at__gte=since, order__execution_point__in=points
    )
    # Родительская запись — «ступень сработала»; дочерние — по одной на канал.
    fired = rows.filter(channel__isnull=True).count()
    failed = rows.filter(status="failed").count()
    return fired, failed


def _services_without_escalation(points) -> list[str]:
    """
    Гостевые сервисы точек скоупа, у которых нет ни одного правила подъёма.

    Служебные сервисы сюда не идут: у них нет гостя, который останется без
    ответа, и требовать от них эскалацию значило бы завести вечную метку.
    """
    from apps.hotels.models import Service
    from apps.notifications.models import EscalationRule

    rules = EscalationRule.objects.filter(is_active=True)
    # ПРАВИЛО С ПУСТОЙ ТОЧКОЙ — ОБЩЕЕ НА ОТЕЛЬ. Оно закрывает всех разом, и
    # ругаться на «сервис без эскалации» при живом общем правиле значило бы
    # гнать человека настраивать то, что уже настроено.
    if rules.filter(execution_point__isnull=True).exists():
        return []
    with_rules = set(rules.values_list("execution_point_id", flat=True))
    return [
        translate(service.public_name, None) or service.code
        for service in Service.objects.filter(
            execution_point__in=points, is_active=True, is_guest_facing=True
        ).select_related("execution_point")
        if service.execution_point_id not in with_rules
    ]


def _stop_list(points) -> int:
    from apps.catalog.models import Item

    return Item.objects.filter(
        in_stock=False,
        is_active=True,
        category__routes__execution_point__in=points,
        category__routes__is_active=True,
    ).distinct().count()


def _offline_node(hotel) -> int | None:
    """Сколько минут молчит узел. `None` — узлов нет или все на связи."""
    for node in OnPremNode.objects.all():
        if not node.is_online:
            seconds = node.seconds_since_seen
            # Узел, который не появлялся НИКОГДА, — это не «офлайн», а
            # незаконченная настройка: пугать им дежурного незачем.
            return seconds // 60 if seconds is not None else None
    return None


def _tariff_overage(hotel) -> list[dict]:
    from apps.hotels.services.platform.usage import usage_for

    return [row for row in usage_for(hotel).get("rows", []) if row.get("over")]


# --- День против вчерашнего ------------------------------------------------


def _today(hotel, user, shift) -> dict:
    """
    Числа дня с дельтой ко вчерашнему. Источник — аналитика, тот же, что кормит
    её собственный экран: второй способ считать заказы за день дал бы два
    разных ответа на один вопрос.
    """
    data = analytics_summary(hotel, user, {"preset": "today", "compare": "previous"})
    current = data["current"]
    delta = data.get("delta") or {}

    return {
        "orders": current["orders"],
        "orders_delta": delta.get("orders"),
        "revenue_minor": current["revenue_minor"],
        "revenue_delta": delta.get("revenue_minor"),
        "avg_rating": current["avg_rating"],
        "rating_delta": delta.get("avg_rating"),
        # Гостей в приложении ПРЯМО СЕЙЧАС — живое число, и дельты у него нет:
        # сравнивать «сейчас» со «вчера в это же время» мы не умеем, а делать
        # вид, что умеем, — хуже, чем не показывать.
        "live_guests": _live_guests(hotel) if scope_for(user).all_points else None,
        # Скорость — МЕДИАНА из сводки смены. `None` значит «за смену нечего
        # мерить», и экран обязан сказать это прочерком, а не нулём.
        "median_minutes": shift["median_minutes"],
        "median_pickup_minutes": shift["median_pickup_minutes"],
        "done": shift["done"],
        "in_work": shift["in_work"],
    }


def _live_guests(hotel) -> int:
    """
    Гостей, чей запрос приходил за последние `LIVE_SESSION_MINUTES`.

    Сессия к точке не привязана, поэтому число отдаётся только тому, кто видит
    отель целиком, — так же, как трафик в аналитике.
    """
    from apps.accounts.models import GuestSession

    now = timezone.now()
    return GuestSession.objects.filter(
        revoked_at__isnull=True,
        expires_at__gt=now,
        last_seen_at__gte=now - timedelta(minutes=LIVE_SESSION_MINUTES),
    ).count()


# --- По заведениям ---------------------------------------------------------


def _venues(hotel, points) -> list[dict]:
    """
    Строка на заведение отвечает «как там дела», а не «сколько там строк меню».

    Справочные «2 сотр. · 8 позиций» уходят: они живут в карточке сервиса, где
    их и правят, а на пульте занимают место, ничего не сообщая.

    Сводка считается КАЖДОЙ точке отдельно — иначе не сказать, где именно
    просрочка, а «где» здесь и есть весь смысл.
    """
    rows = []
    for point in points:
        summary = shift_summary_for([point], hotel=hotel)
        rows.append(
            {
                "code": point.code,
                "title": point.title_i18n or point.code,
                "in_work": summary["in_work"],
                "new": summary["new"],
                "overdue": summary["overdue"],
                "median_minutes": summary["median_minutes"],
                "route": f"/tracker?point={point.code}",
            }
        )
    # Сверху то, где горит: пульт читают в порядке сверху вниз.
    rows.sort(key=lambda row: (-row["overdue"], -row["new"], row["code"]))
    return rows
