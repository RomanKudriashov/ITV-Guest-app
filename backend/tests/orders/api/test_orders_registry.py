"""
РАЗДЕЛ «ЗАКАЗЫ» ОТЕЛЯ: все заведения сразу, фильтры, цифры по выборке.

История доски отвечает на вопрос повара — «что было на моей кухне». Этот
раздел отвечает на вопрос управляющего и администратора — «что происходило в
отеле»: по всем заведениям, за любой период, с цифрами по той выборке, которую
человек сейчас видит.

Проверяем СОСТАВ и ЧИСЛА, а не наличие ответа: список, который отдал что-то,
и список, который отдал правильное, различаются только такими проверками.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.catalog.models import Item
from apps.core.context import tenant_context
from apps.hotels.models import ExecutionPoint
from apps.orders.models import Order
from apps.orders.services import OrderInput, OrderLineInput, create_order
from apps.orders.services.services import change_status

pytestmark = pytest.mark.django_db


def _order_at(point_code: str, *, cancel: bool = False) -> Order:
    item = Item.objects.get(code="caesar")
    order = create_order(OrderInput(lines=[OrderLineInput(item_id=str(item.pk))]))
    Order.objects.filter(pk=order.pk).update(
        execution_point=ExecutionPoint.objects.get(code=point_code)
    )
    order.refresh_from_db()
    if cancel:
        change_status(
            order,
            to_code="cancelled",
            actor_type="staff",
            cancel_reason=Order.CancelReason.OUT_OF_STOCK,
            comment="закончился соус",
        )
    else:
        change_status(order, to_code="done", actor_type="staff")
    order.refresh_from_db()
    return order


def test_the_admin_sees_every_venue_and_the_manager_only_his_own(cms, cms_manager, crystal):
    """
    Раздел режется по карте ролей тем же признаком, что и остальная CMS.
    Управляющий кухней не должен увидеть ни одной заявки бара.
    """
    with tenant_context(crystal):
        kitchen = _order_at("kitchen")
        bar = _order_at("bar")

    everything = cms.get("/api/cms/orders?limit=200").json()
    mine = cms_manager.get("/api/cms/orders?limit=200").json()

    admin_numbers = {row["number"] for row in everything["orders"]}
    manager_numbers = {row["number"] for row in mine["orders"]}

    assert {kitchen.number, bar.number} <= admin_numbers
    assert kitchen.number in manager_numbers
    assert bar.number not in manager_numbers, "управляющий кухней видит заявку бара"

    # И список заведений для фильтра — тоже только свои.
    assert len(everything["points"]) > 1
    assert [point["code"] for point in mine["points"]] == ["kitchen"]


def test_line_staff_is_not_let_into_the_section_at_all(cms_line_staff):
    """Линейному раздела нет вовсе — не «есть, но отказ»."""
    refused = cms_line_staff.get("/api/cms/orders")
    assert refused.status_code == 403
    assert refused.json()["code"] == "no_cms_access"

    navigation = cms_line_staff.get("/api/cms/navigation")
    assert navigation.status_code == 403, "пункт меню не должен даже доехать"


def test_the_section_is_in_the_navigation_of_both_roles(cms, cms_manager):
    """
    Пункт меню есть и у администратора, и у управляющего: раздел сам режется по
    заведениям, и прятать его от управляющего значило бы отнять у него разбор
    собственных заявок.
    """
    for client in (cms, cms_manager):
        keys = [
            item["key"]
            for group in client.get("/api/cms/navigation").json()["groups"]
            for item in group["items"]
        ]
        assert "orders" in keys


def test_numbers_follow_the_filter_and_not_the_page(cms, crystal):
    """
    Цифры считаются ПО ВЫБОРКЕ, а не по странице и не за смену.

    Это ровно та ошибка, ради которой заведена отдельная сводка: над историей
    висела плитка «Сделано 28» (за сегодня) при 986 записях в списке.

    ПРОВЕРЯЕТСЯ ДВУМЯ СПОСОБАМИ, и второй появился после того, как укус
    «считать по странице» не покраснел: первая версия сравнивала только
    выборки между собой, а зависимость цифр от РАЗМЕРА СТРАНИЦЫ не ловила
    вовсе — в тестовой базе записей меньше страницы.
    """
    with tenant_context(crystal):
        for _ in range(4):
            _order_at("kitchen")
        _order_at("kitchen", cancel=True)
        _order_at("bar")
        kitchen_id = str(ExecutionPoint.objects.get(code="kitchen").pk)

    # 1. Цифры НЕ ЗАВИСЯТ от того, сколько записей влезло на страницу.
    page_of_one = cms.get("/api/cms/orders?limit=1").json()
    page_of_many = cms.get("/api/cms/orders?limit=200").json()
    assert len(page_of_one["orders"]) == 1
    assert page_of_one["summary"] == page_of_many["summary"], (
        "сводка меняется вместе с размером страницы — значит считается по странице"
    )
    assert page_of_one["summary"]["orders"] > 1, "сводка посчитала одну страницу"

    # 2. И меняются вместе с фильтром.
    only_kitchen = cms.get(f"/api/cms/orders?limit=1&point={kitchen_id}").json()["summary"]
    only_cancelled = cms.get("/api/cms/orders?limit=1&status=cancelled").json()["summary"]

    assert page_of_one["summary"]["orders"] > only_kitchen["orders"] >= 5, (
        "фильтр по заведению не изменил цифры"
    )
    assert only_cancelled["cancelled"] == only_cancelled["orders"]
    assert only_cancelled["revenue_minor"] == 0, (
        "отменённые заказы не приносят выручки — иначе мы хвалим смену за отказы"
    )


def test_a_card_carries_the_whole_story_of_the_order(cms, crystal):
    """
    Полная карточка: состав, деньги, комната, кто вёл, ВСЕ переходы со
    временем, и — для отменённых — кто отменил и почему.
    """
    with tenant_context(crystal):
        order = _order_at("kitchen", cancel=True)

    rows = cms.get(f"/api/cms/orders?limit=200&search={order.number}").json()["orders"]
    card = next(row for row in rows if row["number"] == order.number)

    assert card["items"], "в карточке нет состава заказа"
    assert card["total"] is not None
    assert "room" in card
    assert card["cancel_reason"] == "out_of_stock"
    assert card["cancel_reason_title"] == "Нет в наличии"

    journal = card["journal"]
    assert len(journal) >= 2, "в карточке не все переходы"
    assert journal[-1]["to"] == "cancelled"
    assert journal[-1]["comment"] == "закончился соус"
    assert journal[-1]["at"]


def test_paging_does_not_repeat_or_skip(cms, crystal):
    with tenant_context(crystal):
        for _ in range(5):
            _order_at("kitchen")

    seen: list[int] = []
    cursor = None
    for _ in range(30):
        url = "/api/cms/orders?limit=2" + (f"&cursor={cursor}" if cursor else "")
        body = cms.get(url).json()
        seen += [row["number"] for row in body["orders"]]
        cursor = body["next_cursor"]
        if not cursor:
            break

    assert len(seen) == len(set(seen)), "листание повторило записи"
    assert len(seen) == cms.get("/api/cms/orders?limit=1").json()["summary"]["orders"]


def test_a_foreign_venue_in_the_url_is_ignored_not_obeyed(cms_manager, crystal):
    """
    Чужое заведение в адресе не должно ни отдавать данные, ни выглядеть
    поломкой: показываем свои, как при любом другом мусоре в фильтре.
    """
    with tenant_context(crystal):
        _order_at("kitchen")
        bar_id = str(ExecutionPoint.objects.get(code="bar").pk)

    body = cms_manager.get(f"/api/cms/orders?limit=200&point={bar_id}").json()
    assert body["orders"], "подмена заведения оставила управляющего с пустым экраном"
    assert all(row["execution_point"]["code"] == "kitchen" for row in body["orders"])
