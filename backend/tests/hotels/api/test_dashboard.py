"""
ДАШБОРД: пульт, а не справка.

Экран показывал три плитки, две из которых меняются раз в месяц, и список
сервисов с «2 сотр. · 8 позиций». Ни одно из этих чисел не требует действия.

Здесь проверяется то, ради чего экран переделан: что горит — видно; чего нет —
не висит нулём; чужого — не видно; чего не знаем — не выдумываем.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.accounts.models import User
from apps.accounts.services.roles import access_for
from apps.catalog.models import Item
from apps.core.context import tenant_context
from apps.hotels.models import ExecutionPoint
from apps.hotels.services.dashboard import build
from apps.orders.models import Order
from apps.orders.services import status_flows

pytestmark = pytest.mark.django_db


def _admin():
    return User.objects.filter(is_hotel_admin=True).first()


def _manager():
    for user in User.objects.filter(is_hotel_admin=False, is_active=True):
        if access_for(user).managed_point_ids:
            return user
    return None


def _point(kind: str) -> ExecutionPoint:
    return ExecutionPoint.objects.prefetch_related("services").filter(kind=kind).first()


def _codes(data) -> set[str]:
    return {card["code"] for card in data["attention"]}


def test_all_clear_says_so_once_instead_of_five_green_zeros(crystal):
    """
    УКУС. Всё в порядке — список ПУСТ, и экран говорит это одной строкой.

    Пять карточек с нулями читаются как список проблем, у которых сейчас
    значение ноль, и глаз перестаёт их различать: когда одна станет единицей,
    её не заметят.
    """
    from apps.notifications.models import EscalationRule, NotificationLog

    with tenant_context(crystal):
        # Гасим всё, что может гореть на сиженном стенде.
        Order.objects.filter(status__is_terminal=False).delete()
        Item.objects.filter(in_stock=False).update(in_stock=True)
        NotificationLog.objects.all().delete()
        # Общее правило на отель закрывает все заведения разом.
        EscalationRule.objects.create(hotel=crystal, execution_point=None, is_active=True)
        # Тариф сида действительно превышен (12 заведений при лимите в одно) —
        # и это НАСТОЯЩИЙ сигнал, а не помеха. Здесь он мешает проверить другое,
        # поэтому переводим отель на безлимитный, а не прячем карточку.
        crystal.tariff = "resort"
        crystal.save(update_fields=["tariff"])

        data = build(crystal, _admin())

        assert data["attention"] == [], f"на чистом отеле что-то горит: {_codes(data)}"


def test_overdue_shows_up_with_a_route_to_the_filtered_board(crystal):
    """
    УКУС. Просрочка есть — карточка есть, и она ведёт на ОТФИЛЬТРОВАННУЮ доску.

    Переход «в трекер вообще» заставляет искать те же заказы глазами по
    колонкам — ровно то, от чего фильтр и делался.
    """
    with tenant_context(crystal):
        point = _point("kitchen")
        initial = next(
            status
            for status in status_flows.statuses_for_flow(status_flows.flow_for_point(point))
            if status.is_initial
        )
        order = Order.objects.create(
            hotel=crystal, number=95001, type=Order.Type.CART, status=initial,
            execution_point=point,
        )
        # Старим заказ за порог точки: свежий просроченным не считается.
        Order.objects.filter(pk=order.pk).update(
            created_at=timezone.now() - timedelta(minutes=point.sla_minutes + 30)
        )

        data = build(crystal, _admin())
        card = next(c for c in data["attention"] if c["code"] == "overdue")

        assert card["count"] >= 1
        assert card["route"] == "/tracker?overdue=1"
        assert card["severity"] == "error"


def test_a_venue_manager_sees_neither_the_node_nor_the_tariff(crystal):
    """
    УКУС. Управляющий заведением не видит узел и тариф.

    Ни то, ни другое ему не подчинено: он не может ни починить связь с
    оборудованием, ни сменить тариф. Тревога без адресата хуже её отсутствия —
    человек видит красное и не знает, что делать.
    """
    with tenant_context(crystal):
        manager = _manager()
        assert manager is not None, "в сиде нет ни одного управляющего — проверять нечего"

        mine = build(crystal, manager)
        theirs = build(crystal, _admin())

        assert "node_offline" not in _codes(mine)
        assert "tariff_over" not in _codes(mine)
        # Скоуп сузился по-настоящему, а не только по этим двум карточкам.
        assert mine["scope"]["all_points"] is False
        assert len(mine["venues"]) < len(theirs["venues"])


def test_a_venue_manager_gets_no_hotel_wide_numbers(crystal):
    """
    Числа чужих точек не приезжают даже в ответе.

    «Фронт их не покажет» — не защита: ответ с чужой выручкой уже утёк, а
    счётчик эскалаций по всему отелю в карточке управляющего баром — это
    тревога, на которую он не может ответить.
    """
    with tenant_context(crystal):
        manager = _manager()
        data = build(crystal, manager)

        # Трафик к точке не привязан — управляющему его не отдают вовсе.
        assert data["today"]["live_guests"] is None
        for venue in data["venues"]:
            assert venue["code"] in {
                point.code for point in ExecutionPoint.objects.filter(
                    pk__in=access_for(manager).managed_point_ids
                )
            }


def test_no_data_is_a_dash_not_a_zero(crystal):
    """
    УКУС. Данных нет — `None`, а не ноль.

    «Обычно занимает 0 минут» экран показал бы как «делаем мгновенно», то есть
    соврал бы в самую лестную сторону. Ноль печатается только тогда, когда его
    действительно посчитали.
    """
    with tenant_context(crystal):
        # Ни одного закрытого заказа за смену — мерить нечего.
        Order.objects.filter(status__is_terminal=True).delete()

        data = build(crystal, _admin())

        assert data["today"]["median_minutes"] is None
        assert data["today"]["median_pickup_minutes"] is None
        # А то, что посчитано, остаётся числом.
        assert isinstance(data["today"]["orders"], int)


def test_a_hotel_wide_escalation_rule_covers_every_venue(crystal):
    """
    Правило с пустой точкой — общее на отель. Ругаться на «заведение без
    эскалации» при живом общем правиле значило бы гнать человека настраивать
    то, что уже настроено.
    """
    from apps.notifications.models import EscalationRule

    with tenant_context(crystal):
        EscalationRule.objects.all().delete()
        assert "no_escalation" in _codes(build(crystal, _admin()))

        EscalationRule.objects.create(hotel=crystal, execution_point=None, is_active=True)
        assert "no_escalation" not in _codes(build(crystal, _admin()))


def test_speed_is_the_median_from_the_shift_summary(crystal):
    """
    Не второй счётчик. Число на пульте обязано совпадать с тем, что показывает
    доска: два ответа на один вопрос — это гарантия, что однажды они разойдутся.
    """
    from apps.orders.services.tracker_shift import shift_summary_for

    with tenant_context(crystal):
        points = list(ExecutionPoint.objects.prefetch_related("services").filter(is_active=True))
        expected = shift_summary_for(points, hotel=crystal)

        data = build(crystal, _admin())

        assert data["today"]["median_minutes"] == expected["median_minutes"]
        assert data["today"]["done"] == expected["done"]
