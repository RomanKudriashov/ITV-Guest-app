"""
КАКОЙ УЗЕЛ ОТЕЛЯ ГЛАВНЫЙ (партия 62-F-хвост).

На стенде у «Кристалла» рядом с живым коннектором завели второй узел, он ни
разу не подключался. Выбор `order_by("-last_seen_at").first()` в Postgres
ставит пустое значение ПЕРВЫМ — и выбирался не подключавшийся: номер гостю
говорил «нет связи», проверка стенда краснела, при работающем коннекторе.

Укусы: живой узел + не подключавшийся (+ отозванный «свежий») →
  * команды идут (`node_is_online`), диагностика видит коннектор на связи;
  * отель на связи в «Отелях»;
  * готовность без «коннектор молчит», в карточке — живой узел;
  * здоровье платформы и сводка панели не тревожат.
"""

from __future__ import annotations

import json
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.core.context import tenant_context
from apps.hotels.models import OnPremNode

pytestmark = pytest.mark.django_db(transaction=True, databases=["default", "platform"])

PLATFORM_EMAIL = "root@platform.test"
PLATFORM_PASSWORD = "platform12345"
BASE_HOST = "guest.localhost"


@pytest.fixture
def api(client):
    from apps.hotels.services.provisioning import ensure_platform_admin

    ensure_platform_admin(email=PLATFORM_EMAIL, password=PLATFORM_PASSWORD)
    token = client.post(
        "/api/v1/platform/auth/login",
        data=json.dumps({"email": PLATFORM_EMAIL, "password": PLATFORM_PASSWORD}),
        content_type="application/json",
        HTTP_HOST=BASE_HOST,
    ).json()["access"]

    def call(path: str):
        return client.get(f"/api/v1/platform{path}", HTTP_HOST=BASE_HOST, HTTP_AUTHORIZATION=f"Bearer {token}")

    return call


@pytest.fixture
def hotel():
    """Живой узел, не подключавшийся и отозванный, но «свежий» по отклику."""
    from apps.hotels.services.provisioning import provision_hotel

    hotel = provision_hotel(subdomain="node-pick", name="Выбор узла", admin_email="admin@node-pick.test").hotel
    now = timezone.now()
    with tenant_context(hotel):
        OnPremNode.objects.create(name="live", purpose="grms", last_seen_at=now - timedelta(seconds=20))
        OnPremNode.objects.create(name="never", purpose="grms", last_seen_at=None)
        OnPremNode.objects.create(name="gone", purpose="grms", last_seen_at=now, is_revoked=True)
    return hotel


def test_rule_pick_node():
    from apps.hotels.services.onprem import link_state, pick_node

    now = timezone.now()
    live_old = OnPremNode(name="a", last_seen_at=now - timedelta(seconds=100))
    live_new = OnPremNode(name="b", last_seen_at=now - timedelta(seconds=5))
    never = OnPremNode(name="c", last_seen_at=None)
    silent = OnPremNode(name="d", last_seen_at=now - timedelta(hours=2))
    revoked = OnPremNode(name="e", last_seen_at=now, is_revoked=True)
    assert pick_node([never, live_old, live_new, revoked]).name == "b"  # на связи и свежий
    assert pick_node([never, silent]).name == "d"  # на связи никого — свежий, пустые в конце
    assert pick_node([never]).name == "c"
    assert pick_node([revoked]) is None
    assert link_state([never, live_old]) == "online"
    assert link_state([never, silent]) == "silent"
    assert link_state([revoked]) == "none"


def test_bite_commands_go_through_the_live_node(hotel):
    from apps.grms.transport import transport

    assert transport.node_is_online(hotel) is True


def test_bite_hotel_is_online_in_hotels_list(api, hotel):
    rows = api("/fleet?layout=list&origin=all&search=node-pick").json()["items"]
    assert [r["link"] for r in rows if r["subdomain"] == "node-pick"] == ["online"]


def test_bite_readiness_has_no_silent_connector_and_shows_the_live_one(hotel):
    from apps.hotels.services.platform import readiness

    result = readiness.compute(hotel)
    assert "connector_silent" not in {p["code"] for p in result["problems"]}
    assert result["facts"]["connector"]["name"] == "live"
    assert result["facts"]["connector"]["online"] is True


def test_bite_health_and_panel_do_not_alarm(api, hotel):
    from apps.hotels.services import dashboard

    signals = api("/overview").json()["health"]
    assert not [s for s in signals if s["code"] == "node_offline" and s.get("subdomain") == "node-pick"]
    with tenant_context(hotel):
        assert dashboard._offline_node(hotel) is None


def test_no_live_node_is_still_silent(hotel):
    """Обратная сторона: живого нет — отель не на связи, проблема есть."""
    from apps.grms.transport import transport
    from apps.hotels.services.platform import readiness

    with tenant_context(hotel):
        OnPremNode.objects.filter(name="live").update(last_seen_at=timezone.now() - timedelta(hours=1))
    assert transport.node_is_online(hotel) is False
    result = readiness.compute(hotel)
    silent = [p for p in result["problems"] if p["code"] == "connector_silent"]
    assert len(silent) == 1 and silent[0]["params"]["node"] == "live"
