"""
ВТОРОЙ ДОМЕН (партия 39): отели и консоль — под несколькими базами.

`<код>.<любая база>` — отель, `<база>` — консоль; наружу (QR, бот) — только
главная (первая) база. Чужой домен не находит ничего — раньше он отдавал
свою первую метку: `crystal.чужой-домен.ru` находил «Кристалл». Разрешённые
хосты и источник сокетов выводятся из списка баз, а не перечисляются.
"""

from __future__ import annotations

import pytest
from asgiref.sync import async_to_sync
from channels.routing import URLRouter
from channels.security.websocket import AllowedHostsOriginValidator
from channels.testing import WebsocketCommunicator
from django.test import override_settings

from apps.core import hosts
from config.domains import allowed_hosts, csrf_trusted_origins, parse_bases

NEW = "naviapp.example.test"
OLD = "app.10.0.0.1.sslip.io"
BASES = [NEW, OLD]

pytestmark = pytest.mark.django_db

two_bases = override_settings(
    GUEST_APP_BASE_DOMAINS=BASES,
    GUEST_APP_BASE_DOMAIN=NEW,
    GUEST_APP_PUBLIC_SCHEME="https",
)


def test_bases_parse_in_order_and_the_first_is_primary():
    assert parse_bases(f" {NEW.upper()} , .{OLD}, {NEW}") == [NEW, OLD]


def test_hosts_and_form_origins_are_derived_from_the_list():
    assert {f".{NEW}", NEW, f".{OLD}", OLD} <= set(allowed_hosts(BASES))
    origins = csrf_trusted_origins(BASES)
    for base in BASES:
        assert f"https://*.{base}" in origins and f"https://{base}" in origins


@two_bases
def test_a_hotel_is_found_by_its_code_under_either_base():
    assert hosts.resolve_subdomain(f"crystal.{NEW}") == "crystal"
    assert hosts.resolve_subdomain(f"crystal.{OLD}:443") == "crystal"
    assert hosts.is_platform_host(NEW) and hosts.is_platform_host(OLD)


@two_bases
def test_a_foreign_domain_finds_nothing():
    assert hosts.resolve_subdomain("crystal.evil.example.com") is None
    assert hosts.is_platform_host("crystal.evil.example.com") is False
    assert hosts.custom_domain_hotel("crystal.evil.example.com") is None


@two_bases
def test_http_hotel_by_new_base_unknown_code_and_foreign_domain(client, crystal):
    found = client.get("/api/v1/guest/hotel", HTTP_HOST=f"crystal.{NEW}")
    assert found.status_code != 404 and found.json().get("code") not in {"unknown_tenant", "tenant_required"}

    unknown = client.get("/api/v1/guest/hotel", HTTP_HOST=f"nosuchhotel.{NEW}")
    assert unknown.status_code == 404 and unknown.json()["code"] == "unknown_tenant"

    foreign = client.get("/api/v1/guest/hotel", HTTP_HOST="crystal.evil.example.com")
    assert foreign.status_code == 400 and foreign.json()["code"] == "tenant_required"


@two_bases
def test_the_console_answers_on_both_bases_and_nowhere_else(client):
    for host in (NEW, OLD):
        response = client.get("/api/v1/platform/auth/me", HTTP_HOST=host)
        assert response.json().get("code") != "platform_wrong_host", host
    for host in (f"crystal.{NEW}", "evil.example.com"):
        response = client.get("/api/v1/platform/auth/me", HTTP_HOST=host)
        assert response.status_code == 404 and response.json()["code"] == "platform_wrong_host", host


@two_bases
def test_qr_and_the_bot_link_use_the_primary_base(crystal):
    from apps.notifications.services.bot_actions import tracker_url

    assert crystal.room_deeplink("305").startswith(f"https://crystal.{NEW}/r/")
    assert tracker_url(crystal, "abc").startswith(f"https://crystal.{NEW}/tracker/order/")


# Консьюмер ходит в базу из своего потока — как у тестов сокетов, настоящие транзакции.
@pytest.mark.django_db(transaction=True)
def test_a_socket_from_a_base_origin_connects_and_from_a_foreign_one_does_not(crystal):
    """
    Проверка источника сокетов — из того же выведенного списка хостов.

    Посторонний источник проверка закрывает ДО принятия: подключения нет.
    Источник базы проходит её — консьюмер принимает соединение (и закрывает
    уже сам, за поддельный токен: это не проверка источника).
    """
    from apps.realtime.routing import browser_urlpatterns

    with override_settings(ALLOWED_HOSTS=allowed_hosts(BASES), GUEST_APP_BASE_DOMAINS=BASES, GUEST_APP_BASE_DOMAIN=NEW):
        app = AllowedHostsOriginValidator(URLRouter(browser_urlpatterns))
        allowed = async_to_sync(_handshake)(app, f"https://crystal.{NEW}")
        old = async_to_sync(_handshake)(app, f"https://crystal.{OLD}")
        refused = async_to_sync(_handshake)(app, "https://evil.example.com")
    assert allowed is True, "источник новой базы проходит проверку"
    assert old is True, "и старой — тоже"
    assert refused is False, "посторонний источник — нет"


async def _handshake(app, origin: str) -> bool:
    communicator = WebsocketCommunicator(
        app,
        "/ws/v1/guest/chat/?token=x&hotel=crystal",
        headers=[(b"origin", origin.encode()), (b"host", f"crystal.{NEW}".encode())],
    )
    connected, _ = await communicator.connect(timeout=10)
    if connected:
        await communicator.disconnect()
    return connected
