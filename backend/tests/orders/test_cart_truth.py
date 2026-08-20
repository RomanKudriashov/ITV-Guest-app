"""
КОРЗИНА НЕ ВРЁТ О ПОЗИЦИЯХ.

Строка корзины — снимок на момент добавления: название, цена, надбавки
модификаторов. Мир за это время меняется, а снимок нет. Проверяем, что правду
говорит сервер: котировка размечает каждую строку и считает по живым ценам, а
оформление недоступную позицию не пропускает.

Разделение намеренное: КОТИРОВКУ спрашивают, чтобы узнать положение дел, и
отказ на весь запрос был бы ответом «не скажу». ОФОРМЛЕНИЕ — это обязательство,
и здесь отказ единственно верен.
"""

from __future__ import annotations

import pytest

from apps.catalog.models import Item
from apps.core.context import tenant_context

from tests.conftest import host_for

pytestmark = pytest.mark.django_db


def _quote(client, hotel, token, lines):
    return client.post(
        "/api/v1/guest/cart/quote",
        data={"lines": lines, "timing": "asap"},
        content_type="application/json",
        HTTP_HOST=host_for(hotel),
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )


def _order(client, hotel, token, lines, key="bite-1"):
    return client.post(
        "/api/v1/guest/order",
        data={"lines": lines, "timing": "asap", "comment": ""},
        content_type="application/json",
        HTTP_HOST=host_for(hotel),
        HTTP_AUTHORIZATION=f"Bearer {token}",
        # Оформление идемпотентно по ключу — без него ручка не пускает вовсе.
        HTTP_IDEMPOTENCY_KEY=key,
    )


@pytest.fixture
def caesar(crystal):
    with tenant_context(crystal):
        item = Item.objects.get(code="caesar")
        return {"id": str(item.pk), "price": item.price}


def test_quote_carries_the_live_price_per_line(client, crystal, guest_token, caesar):
    """
    Цена на строке приезжает С СЕРВЕРА, а не из снимка.

    Витрина показывала цену, замороженную при добавлении: подорожавшее блюдо
    стояло со старой ценой, хотя в итоге считалось по новой.
    """
    body = _quote(client, crystal, guest_token, [{"item_id": caesar["id"], "quantity": 2}]).json()
    line = body["lines"][0]
    assert line["item_id"] == caesar["id"]
    assert line["unit_price_minor"] == caesar["price"]
    assert line["line_total_minor"] == caesar["price"] * 2
    assert line["is_available"] is True
    assert body["has_unavailable"] is False

    # Цена выросла — котировка говорит новую, без всякого участия клиента.
    with tenant_context(crystal):
        Item.objects.filter(pk=caesar["id"]).update(price=caesar["price"] + 50000)

    after = _quote(client, crystal, guest_token, [{"item_id": caesar["id"], "quantity": 2}]).json()
    assert after["lines"][0]["unit_price_minor"] == caesar["price"] + 50000


def test_quote_marks_the_unavailable_line_instead_of_refusing_everything(
    client, crystal, guest_token, caesar
):
    """
    ГЛАВНОЕ. Раньше одна недоступная позиция роняла ВЕСЬ расчёт: гость видел
    ошибку вместо корзины и не мог понять, какая строка виновата.
    """
    with tenant_context(crystal):
        Item.objects.filter(pk=caesar["id"]).update(in_stock=False)

    response = _quote(client, crystal, guest_token, [{"item_id": caesar["id"], "quantity": 1}])
    assert response.status_code == 200, response.content
    body = response.json()

    line = body["lines"][0]
    assert line["is_available"] is False
    assert line["unavailable_reason"] == "out_of_stock"
    assert body["has_unavailable"] is True
    # Недоступное не считается: итог не обещает суммы, которую нельзя оплатить.
    assert body["subtotal_minor"] == 0


@pytest.mark.parametrize(
    "field,value,reason",
    [
        ("in_stock", False, "out_of_stock"),
        ("is_active", False, "inactive"),
    ],
)
def test_quote_tells_the_reasons_apart(client, crystal, guest_token, caesar, field, value, reason):
    """
    Стоп-лист и снятие с витрины — разные причины, и гость должен видеть разные.
    «Недоступно» без причины не отвечает на вопрос «ждать или убрать».
    """
    with tenant_context(crystal):
        Item.objects.filter(pk=caesar["id"]).update(**{field: value})

    body = _quote(client, crystal, guest_token, [{"item_id": caesar["id"], "quantity": 1}]).json()
    assert body["lines"][0]["unavailable_reason"] == reason


def test_deleted_item_is_reported_not_swallowed(client, crystal, guest_token, caesar):
    """Позиции нет вовсе — строка на экране есть, и молчать о ней нельзя."""
    with tenant_context(crystal):
        Item.all_objects.filter(pk=caesar["id"]).delete()

    body = _quote(client, crystal, guest_token, [{"item_id": caesar["id"], "quantity": 1}]).json()
    assert body["lines"][0]["is_available"] is False
    assert body["lines"][0]["unavailable_reason"] == "not_found"


def test_order_with_an_unavailable_line_is_refused(client, crystal, guest_token, caesar):
    """
    УКУС ПРО ОБХОД ИНТЕРФЕЙСА. Экран запирает кнопку, но запрос можно послать и
    мимо экрана — и вот тогда решает сервер.
    """
    with tenant_context(crystal):
        Item.objects.filter(pk=caesar["id"]).update(in_stock=False)

    response = _order(client, crystal, guest_token, [{"item_id": caesar["id"], "quantity": 1}])
    assert response.status_code == 422, response.content
    assert response.json()["code"] == "item_unavailable"


def test_order_goes_through_at_the_new_price(client, crystal, guest_token, caesar):
    """
    Оформление идёт ПО НОВОЙ цене, и это не правка, а проверка: сервер никогда
    не принимал цену от клиента — он считает по своим данным.
    """
    with tenant_context(crystal):
        Item.objects.filter(pk=caesar["id"]).update(price=caesar["price"] + 70000)

    response = _order(client, crystal, guest_token, [{"item_id": caesar["id"], "quantity": 1}])
    assert response.status_code in (200, 201), response.content
    charges = response.json()["charges"]
    assert charges["subtotal_minor"] == caesar["price"] + 70000
