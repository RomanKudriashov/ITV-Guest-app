"""
Изоляция тенантов — обязательный тест фундамента.

Проверяется на трёх уровнях, потому что защита эшелонированная:
  1. ORM: менеджер сам скоупит запросы по текущему отелю;
  2. Postgres RLS: сырой SQL под ролью приложения тоже не видит чужого;
  3. HTTP: токен одного отеля не работает на поддомене другого.
"""

from __future__ import annotations

import pytest
from django.db import connection

from apps.catalog.models import Item
from apps.core.context import platform_scope, tenant_context
from apps.hotels.models import Room

from .conftest import host_for

pytestmark = pytest.mark.django_db


# --- 1. Уровень ORM --------------------------------------------------------


def test_manager_scopes_queries_to_current_hotel(crystal, aurora):
    with tenant_context(crystal):
        crystal_items = set(Item.objects.values_list("code", flat=True))
        crystal_hotels = set(Item.objects.values_list("hotel_id", flat=True))

    with tenant_context(aurora):
        aurora_items = set(Item.objects.values_list("code", flat=True))
        aurora_hotels = set(Item.objects.values_list("hotel_id", flat=True))

    assert crystal_items, "сид должен был создать позиции"
    assert crystal_hotels == {crystal.pk}
    assert aurora_hotels == {aurora.pk}
    # Коды совпадают (одинаковый сид) — а вот строки должны быть разные.
    assert crystal_items == aurora_items


def test_no_tenant_context_yields_nothing(crystal):
    """Fail-closed: забыл контекст — получил пустоту, а не чужие данные."""
    assert Item.objects.count() == 0
    assert Room.objects.count() == 0


def test_platform_scope_alone_is_not_enough(crystal, aurora):
    """
    platform_scope() снимает фильтр ORM, но НЕ снимает RLS: соединение роли
    приложения по-прежнему ничего не отдаёт. Это ровно то поведение, которого
    мы хотим — выйти за пределы отеля можно только через платформенную роль.
    """
    with platform_scope():
        assert Item.objects.count() == 0


@pytest.mark.django_db(transaction=True, databases=["default", "platform"])
def test_platform_role_bypasses_rls():
    """Платформенная роль (BYPASSRLS) видит все отели — это её назначение."""
    from django.core.management import call_command

    call_command("seed_demo_hotel", "--with-second-hotel", verbosity=0)

    with platform_scope():
        hotel_ids = set(
            Item.all_objects.using("platform").values_list("hotel_id", flat=True)
        )

    from apps.hotels.models import Hotel

    expected = set(Hotel.objects.values_list("pk", flat=True))
    assert len(expected) >= 2
    assert expected <= hotel_ids


# --- 2. Уровень Postgres (RLS) --------------------------------------------


def test_rls_blocks_raw_sql_across_tenants(crystal, aurora):
    """
    Сырой SQL мимо ORM. Если бы RLS не было, вернулись бы строки обоих отелей.
    """
    with tenant_context(aurora):
        with connection.cursor() as cursor:
            cursor.execute("SELECT DISTINCT hotel_id FROM catalog_item")
            hotel_ids = {row[0] for row in cursor.fetchall()}

    assert hotel_ids == {aurora.pk}, "RLS пропустил строки чужого отеля"


def test_rls_policy_is_enabled_and_forced(crystal):
    """
    FORCE обязателен: без него владелец таблицы (роль миграций) игнорирует
    политику, и вся защита существует только на бумаге.
    """
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT relrowsecurity, relforcerowsecurity
            FROM pg_class WHERE relname = 'catalog_item'
            """
        )
        enabled, forced = cursor.fetchone()
        cursor.execute("SELECT polname FROM pg_policy p "
                       "JOIN pg_class c ON c.oid = p.polrelid "
                       "WHERE c.relname = 'catalog_item'")
        policies = {row[0] for row in cursor.fetchall()}

    assert enabled is True
    assert forced is True
    assert "tenant_isolation" in policies


# --- 3. Уровень HTTP -------------------------------------------------------


def test_guest_token_does_not_work_on_another_hotel(client, crystal, aurora, guest_token):
    """Токен, выданный «Кристаллом», на поддомене Aurora — чужой."""
    ok = client.get(
        "/api/guest/menu",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {guest_token}",
    )
    assert ok.status_code == 200

    denied = client.get(
        "/api/guest/menu",
        HTTP_HOST=host_for(aurora),
        HTTP_AUTHORIZATION=f"Bearer {guest_token}",
    )
    assert denied.status_code == 401


def test_menu_returns_only_own_hotel_items(client, crystal, aurora, guest_token):
    crystal_menu = client.get(
        "/api/guest/menu",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {guest_token}",
    ).json()

    crystal_item_ids = {
        item["id"]
        for category in crystal_menu["categories"]
        for item in category["items"]
    }
    with tenant_context(aurora):
        aurora_item_ids = {str(pk) for pk in Item.objects.values_list("pk", flat=True)}

    assert crystal_item_ids
    assert crystal_item_ids.isdisjoint(aurora_item_ids)


def test_unknown_subdomain_is_rejected(client):
    response = client.get("/api/guest/menu", HTTP_HOST="nosuchhotel.guest.localhost")
    assert response.status_code == 404
    assert response.json()["code"] == "unknown_tenant"
