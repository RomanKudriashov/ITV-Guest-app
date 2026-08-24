"""
РАЗНЫЕ РАБОЧИЕ МЕСТА — ЧЕРЕЗ РЕЕСТР.

До этой правки `BOARD`, `QUEUE` и `REQUESTS` были тремя ДОСЛОВНО одинаковыми
наборами полей: колонки по статусам, сортировка по времени создания,
терминальные уходят. Различались они только потоком статусов, то есть подписями
на колонках. Ресепшен и кухня работали по одному экрану.

Теперь вид работы приносит два признака — чем собирать задачи и сколько колонок
рисовать — и свой порог просрочки. Проверяется и то, что признаки работают, и
то, что прикладной код их не обходит сравнением типа сервиса.
"""

from __future__ import annotations

import pytest

from apps.core.context import tenant_context
from apps.hotels.models import ExecutionPoint, Room
from apps.orders.models import Order
from apps.orders.services import status_flows
from apps.orders.services.tracker import build_board
from apps.orders.services.tracker_types import (
    DEFAULT_SLA_MINUTES,
    ColumnStyle,
    GroupBy,
    effective_sla_minutes,
    tracker_behaviour,
)

pytestmark = pytest.mark.django_db


def _point(kind: str) -> ExecutionPoint:
    return ExecutionPoint.objects.prefetch_related("services").filter(kind=kind).first()


def _request(hotel, point, room, number: int) -> Order:
    initial = next(
        status
        for status in status_flows.statuses_for_flow(status_flows.flow_for_point(point))
        if status.is_initial
    )
    return Order.objects.create(
        hotel=hotel,
        number=number,
        type=Order.Type.REQUEST,
        status=initial,
        execution_point=point,
        room=room,
    )


def test_housekeeping_two_requests_to_one_room_are_one_card(crystal):
    """
    УКУС. Две заявки в один номер — ОДНА группа, а не две карточки в разных
    местах колонки.

    Горничная идёт по этажу: полотенца и уборка в 201 — это один поход. Раньше
    вторую заявку находили, уже выйдя из номера.
    """
    with tenant_context(crystal):
        point = _point("housekeeping")
        rooms = list(Room.objects.all()[:2])
        _request(crystal, point, rooms[0], 91001)
        _request(crystal, point, rooms[0], 91002)
        _request(crystal, point, rooms[1], 91003)

        board = build_board(point, scope="active", language="ru")
        column = next(c for c in board["columns"] if c["orders"])
        groups = {group["room"]: len(group["orders"]) for group in column["groups"]}

        assert groups == {rooms[0].number: 2, rooms[1].number: 1}
        # Плоский список остаётся: по нему считают счётчики и ищут.
        assert len(column["orders"]) == 3


def test_reception_is_one_lane_not_two_half_empty_columns(crystal):
    """
    Два статуса ресепшена делили экран пополам: «Новая 6 / Подтверждена 0» —
    это не две колонки работы, это одна колонка и одна пустая половина.
    """
    with tenant_context(crystal):
        point = _point("reception")
        board = build_board(point, scope="active", language="ru")

        assert tracker_behaviour(point).column_style == ColumnStyle.SINGLE
        assert len(board["columns"]) == 1
        assert board["columns"][0]["code"] == "all"


def test_the_kitchen_board_keeps_its_columns(crystal):
    """
    ОБРАТНАЯ СТОРОНА. Обобщение не имело права поменять поведение доски, по
    которой кухня работала до сих пор: у неё колонки по статусам и никаких
    групп.
    """
    with tenant_context(crystal):
        point = _point("kitchen")
        behaviour = tracker_behaviour(point)
        board = build_board(point, scope="active", language="ru")

        assert behaviour.column_style == ColumnStyle.MANY
        assert behaviour.group_by == GroupBy.STATUS
        assert len(board["columns"]) > 1
        assert all("groups" not in column for column in board["columns"])


def test_concierge_threshold_is_not_the_kitchen_threshold(crystal):
    """
    Заказать билеты не делается за двадцать минут. Порог кухни красил бы у
    консьержа просрочкой вообще всё, а тревога, включённая всегда, не значит
    ничего.
    """
    from apps.orders.services.tracker_types import BEHAVIOURS, TrackerType

    assert BEHAVIOURS[TrackerType.REQUESTS].sla_minutes is not None
    assert BEHAVIOURS[TrackerType.BOARD].sla_minutes is None


def test_empty_threshold_takes_the_default_of_the_work_kind(crystal):
    """
    УКУС. Поле пустое — порог берётся из ТИПА.

    Раньше отличить «оператор выбрал двадцать» от «поле никто не трогал» было
    нечем: у поля стояло значение по умолчанию, и код принимал его за
    «не трогали», ошибаясь ровно у тех, кто выбрал двадцать осознанно.
    """
    from apps.orders.services.tracker_types import BEHAVIOURS, TrackerType

    with tenant_context(crystal):
        point = _point("reception")
        point.sla_minutes = None
        assert effective_sla_minutes(point) == BEHAVIOURS[TrackerType.REQUESTS].sla_minutes

        # У доски своего умолчания нет — падаем на общее, а не на порог заявок.
        kitchen = _point("kitchen")
        kitchen.sla_minutes = None
        assert effective_sla_minutes(kitchen) == DEFAULT_SLA_MINUTES


def test_a_hand_set_threshold_survives_a_change_of_kind(crystal):
    """
    УКУС. Заданный руками порог переживает смену вида работы.

    Это и есть разница между хранимым намерением и догадкой: раньше значение,
    совпавшее с умолчанием, тихо переставало быть выбором, стоило точке
    сменить тип. Двадцать минут, выбранные оператором, обязаны остаться
    двадцатью и у заявок, где умолчание — четыре часа.
    """
    with tenant_context(crystal):
        point = _point("reception")
        point.sla_minutes = 20
        # Ровно то число, которое РАНЬШЕ считалось «не трогали».
        assert effective_sla_minutes(point) == 20

        kitchen = _point("kitchen")
        kitchen.sla_minutes = 20
        assert effective_sla_minutes(kitchen) == 20


def test_the_board_says_where_the_threshold_came_from(crystal):
    """
    «Просрочка — позже 240 минут» без пояснения читается как чья-то настройка,
    и управляющий идёт искать, кто её поставил, — хотя никто не ставил.
    """
    from apps.orders.services.tracker import build_board

    with tenant_context(crystal):
        point = _point("reception")

        point.sla_minutes = None
        point.save(update_fields=["sla_minutes"])
        assert build_board(point, scope="active", language="ru")["point"]["sla_source"] == "type"

        point.sla_minutes = 30
        point.save(update_fields=["sla_minutes"])
        assert build_board(point, scope="active", language="ru")["point"]["sla_source"] == "point"


def test_every_reader_of_the_threshold_gets_the_same_number(crystal):
    """
    Порог спрашивают карточка, фильтр, плитка сводки и подпись под доской.
    Четыре ответа на один вопрос обязаны совпадать.
    """
    with tenant_context(crystal):
        point = _point("reception")
        point.sla_minutes = None
        point.save(update_fields=["sla_minutes"])

        board = build_board(point, scope="active", language="ru")
        expected = effective_sla_minutes(point)

        assert board["point"]["sla_minutes"] == expected
        assert board["shift"]["sla_minutes"] == expected


def test_no_service_type_comparisons_in_board_assembly():
    """
    СТОРОЖ РЕЕСТРА. Разбор по типу сервиса живёт РОВНО в одном файле —
    `tracker_types.py`. Сравнение вида `service.type == "housekeeping"` в
    сборке доски и есть та трещина, ради устранения которой реестр писался: с
    ним новый вид сервиса требовал бы правок в разных местах, и одно из них
    однажды забыли бы.
    """
    import ast
    import pathlib

    KINDS = {
        "housekeeping", "spa", "concierge", "restaurant", "bar",
        "transfer", "pool", "excursions", "minibar", "room_service",
    }
    root = pathlib.Path(__file__).resolve().parents[3] / "apps" / "orders"

    def compares_type_with_a_kind(node: ast.AST) -> bool:
        """Сравнение атрибута `.type` со строкой-видом сервиса."""
        if not isinstance(node, ast.Compare):
            return False
        touches_type = isinstance(node.left, ast.Attribute) and node.left.attr == "type"
        literals = {
            operand.value
            for operand in node.comparators
            if isinstance(operand, ast.Constant) and isinstance(operand.value, str)
        }
        return touches_type and bool(literals & KINDS)

    offenders = []
    for path in root.rglob("*.py"):
        if path.name == "tracker_types.py":
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if compares_type_with_a_kind(node):
                offenders.append(f"{path.relative_to(root)}:{node.lineno}")

    # Разбор СИНТАКСИСА, а не текста: первая версия искала подстроку и нашла
    # собственный поясняющий комментарий в docstring — сторож, ловящий прозу,
    # выключают на первой же правке документации.
    assert not offenders, "разбор по типу сервиса вне реестра: " + ", ".join(offenders)
