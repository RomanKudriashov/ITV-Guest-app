"""
Порог просрочки точки поверх умолчания вида работы — пара-оверрайд.

НАСЛЕДОВАНИЕ ЗДЕСЬ УЖЕ РАБОТАЛО, и работало правильно: единственный ответ даёт
`orders.services.tracker_types.effective_sla_minutes()`, а `NULL` означает «не
задавали, берите умолчание вида работы». Поле специально сделали nullable
(миграция hotels.0023) именно затем, чтобы «выбрал двадцать» и «не трогал»
перестали быть одним и тем же.

ЧЕГО НЕ БЫЛО — ВИДА СВЕРХУ. Отдельно взятая точка показывает свой порог и то,
откуда он взялся. А вопрос «где у нас вообще переопределено» требовал открыть
все точки по очереди, и ответ на него зависел от терпения спрашивающего.

ПОЧЕМУ ЭТО ВАЖНЕЕ, ЧЕМ КАЖЕТСЯ. Порог красит заказы просрочкой, просрочка
поднимает эскалацию, эскалация будит старшего. Точка с порогом в пять минут,
поставленным когда-то на время, разбудит его сегодня ночью — и никто не
вспомнит, что этот порог там стоит.

ИСТОЧНИК ЗДЕСЬ НЕ ОДИН НА ВСЕХ. У справочника эталон общий, а у порога он свой
для каждого вида работы: у кухни одно умолчание, у консьержа другое. Поэтому
источник спрашивается ПО ТОЧКЕ, а не берётся из одного словаря — и `source`
в отчёте у разных строк разный.
"""

from __future__ import annotations

from apps.accounts.services.roles import require_hotel_admin
from apps.hotels.models import ExecutionPoint
from apps.hotels.services import inheritance

FIELD = "sla_minutes"


def _default_for(point: ExecutionPoint) -> int:
    """
    Умолчание вида работы — то, что получила бы точка с пустым порогом.

    Спрашиваем у того же модуля, который отвечает на вопрос в бою. Своя копия
    правила дала бы экран, расходящийся с доской, — и разошлась бы молча.
    """
    from apps.orders.services.tracker_types import DEFAULT_SLA_MINUTES, tracker_behaviour

    behaviour = tracker_behaviour(point)
    return behaviour.sla_minutes if behaviour.sla_minutes is not None else DEFAULT_SLA_MINUTES


def report() -> dict:
    """
    Где порог переопределён, а где унаследован.

    В отличие от коммерции, здесь возвращаются ВСЕ точки: экран отвечает не
    только «где своё», но и «сколько у нас точек вообще» — без знаменателя
    число переопределений ни о чём не говорит.
    """
    # Права проверяет СЕРВИС, как и все соседние: вьюхи здесь тонкие, и
    # ручка без этой строки была бы доступна любому вошедшему сотруднику —
    # включая исполнителя, которому пороги чужих точек знать незачем.
    require_hotel_admin()

    rows = []
    overridden = 0
    for point in ExecutionPoint.objects.filter(is_active=True).order_by("kind", "code"):
        default = _default_for(point)
        divergences = inheritance.classify_overrides(
            {(FIELD,): default},
            {(FIELD,): point.sla_minutes} if point.sla_minutes is not None else {},
        )
        state = divergences[0].state.value if divergences else "inherited"
        if divergences:
            overridden += 1
        rows.append(
            {
                "point_id": str(point.pk),
                "code": point.code,
                "title": point.title,
                "kind": point.kind,
                "state": state,
                "default_minutes": default,
                "own_minutes": point.sla_minutes,
                # Что реально применяется — чтобы экран не заставлял считать в
                # уме и не разошёлся с подписью под доской.
                "effective_minutes": point.sla_minutes if point.sla_minutes is not None else default,
            }
        )

    return {
        "points": rows,
        "overridden": overridden,
        "total_points": len(rows),
    }


def reset(point_ids: list[str]) -> int:
    """
    Вернуть точки к умолчанию вида работы — явным действием.

    Ставим `NULL`, а не число: скопировать умолчание значило бы закрепить его
    навсегда под видом возврата к наследованию.
    """
    require_hotel_admin()

    changed = 0
    for point in ExecutionPoint.objects.filter(pk__in=point_ids, sla_minutes__isnull=False):
        point.sla_minutes = None
        point.save(update_fields=[FIELD, "updated_at"])
        changed += 1
    return changed
