"""
Усиленный вход в корневую админку (R6): TOTP и IP-allowlist.

/admin — мастер-ключ ко ВСЕМ отелям, поэтому здесь проверяется не «форма
работает», а что рубеж НЕЛЬЗЯ обойти: старым токеном, кодом от чужого секрета,
с адреса вне списка.
"""

from __future__ import annotations

import json

import pytest

from apps.accounts import totp
from apps.accounts.models import User
from apps.core.context import platform_scope
from apps.core.models import AuditLog
from apps.hotels.provisioning import ensure_platform_admin

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

BASE_HOST = "guest.localhost"
EMAIL = "root@platform.test"
PASSWORD = "platform12345"


def _login(client, **body):
    return client.post(
        "/api/v1/platform/auth/login",
        data=json.dumps({"email": EMAIL, "password": PASSWORD, **body}),
        content_type="application/json",
        HTTP_HOST=BASE_HOST,
    )


def _call(client, token, method, path, body=None):
    kw = {"HTTP_HOST": BASE_HOST, "HTTP_AUTHORIZATION": f"Bearer {token}"}
    if body is not None:
        return getattr(client, method)(
            f"/api/v1/platform{path}", data=json.dumps(body),
            content_type="application/json", **kw,
        )
    return getattr(client, method)(f"/api/v1/platform{path}", **kw)


@pytest.fixture
def admin_token(client):
    ensure_platform_admin(email=EMAIL, password=PASSWORD)
    resp = _login(client)
    assert resp.status_code == 200, resp.content
    return resp.json()["access"]


def _reload(email: str = EMAIL) -> User:
    with platform_scope():
        return User.all_objects.using("platform").get(email=email)


# --- TOTP как алгоритм -----------------------------------------------------


def test_totp_matches_rfc_vector():
    """
    Контрольный вектор RFC 6238 (секрет "12345678901234567890" в base32).
    Своя реализация обязана совпадать с эталоном, иначе приложения-
    аутентификаторы будут давать «неверный код» на верном секрете.
    """
    secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
    assert totp.code_at(secret, 59) == "287082"
    assert totp.code_at(secret, 1111111109) == "081804"


def test_totp_window_accepts_neighbour_step_but_not_far_past():
    secret = totp.generate_secret()
    now = 1_700_000_000
    assert totp.verify(secret, totp.code_at(secret, now), now)
    # Часы разошлись на шаг — принимаем: иначе честный код отвергался бы.
    assert totp.verify(secret, totp.code_at(secret, now - totp.STEP_SECONDS), now)
    # Пять минут назад — уже не окно, а дыра.
    assert not totp.verify(secret, totp.code_at(secret, now - 300), now)


def test_totp_rejects_garbage():
    secret = totp.generate_secret()
    for junk in ("", "abcdef", "12345", "1234567", None):
        assert not totp.verify(secret, junk or "")


# --- Второй фактор во входе ------------------------------------------------


def test_enabling_2fa_requires_code_and_makes_login_two_step(client, admin_token):
    setup = _call(client, admin_token, "post", "/auth/2fa/setup")
    assert setup.status_code == 200
    secret = setup.json()["secret"]
    assert setup.json()["otpauth_url"].startswith("otpauth://totp/")

    # Неверный код не включает 2FA — иначе рубеж ставился бы вслепую.
    bad = _call(client, admin_token, "post", "/auth/2fa/enable", {"code": "000000"})
    assert bad.status_code == 422
    assert not _reload().totp_enabled

    ok = _call(client, admin_token, "post", "/auth/2fa/enable", {"code": totp.code_at(secret)})
    assert ok.status_code == 200
    assert _reload().totp_enabled

    # Пароля больше недостаточно: вход стал двухшаговым.
    first = _login(client)
    assert first.status_code == 401
    assert first.json()["code"] == "mfa_required"

    wrong = _login(client, totp_code="000000")
    assert wrong.status_code == 401
    assert wrong.json()["code"] == "mfa_invalid"

    second = _login(client, totp_code=totp.code_at(secret))
    assert second.status_code == 200
    assert second.json()["user"]["totp_enabled"] is True


def test_token_issued_before_2fa_stops_working_after_it(client, admin_token):
    """
    Главное свойство рубежа: включение 2FA обесценивает уже выданные токены.
    Иначе украденный до включения токен продолжал бы открывать все отели, и
    рубеж поднимался бы только для будущих входов.
    """
    assert _call(client, admin_token, "get", "/hotels").status_code == 200

    setup = _call(client, admin_token, "post", "/auth/2fa/setup")
    secret = setup.json()["secret"]
    enabled = _call(client, admin_token, "post", "/auth/2fa/enable", {"code": totp.code_at(secret)})

    assert _call(client, admin_token, "get", "/hotels").status_code == 401
    # А выданный при включении — работает, иначе включивший запер бы сам себя.
    fresh = enabled.json()["access"]
    assert _call(client, fresh, "get", "/hotels").status_code == 200


def test_disable_2fa_returns_login_to_one_step(client, admin_token):
    secret = _call(client, admin_token, "post", "/auth/2fa/setup").json()["secret"]
    fresh = _call(client, admin_token, "post", "/auth/2fa/enable",
                  {"code": totp.code_at(secret)}).json()["access"]
    assert _call(client, fresh, "post", "/auth/2fa/disable").status_code == 200

    assert _login(client).status_code == 200
    user = _reload()
    assert not user.totp_enabled and user.totp_secret == ""


# --- Рубеж по адресу -------------------------------------------------------


def test_ip_allowlist_blocks_login_and_token(client, admin_token, settings):
    settings.PLATFORM_IP_ALLOWLIST = ["203.0.113.0/24"]

    # Токен, выданный раньше, с чужого адреса больше не работает.
    denied = _call(client, admin_token, "get", "/hotels")
    assert denied.status_code == 401

    blocked = _login(client)
    assert blocked.status_code == 403
    assert blocked.json()["code"] == "ip_not_allowed"

    # С разрешённого адреса — пускают. REMOTE_ADDR подменяем как это делает прокси.
    allowed = client.post(
        "/api/v1/platform/auth/login",
        data=json.dumps({"email": EMAIL, "password": PASSWORD}),
        content_type="application/json",
        HTTP_HOST=BASE_HOST,
        REMOTE_ADDR="203.0.113.7",
    )
    assert allowed.status_code == 200


def test_allowlist_reads_first_forwarded_address(client, admin_token, settings):
    """
    За прокси доверяем ПЕРВОМУ адресу X-Forwarded-For. Последний дописан самим
    прокси: сверяясь с ним, мы пускали бы по адресу своего балансировщика — то
    есть кого угодно.
    """
    settings.PLATFORM_IP_ALLOWLIST = ["203.0.113.0/24"]
    resp = client.get(
        "/api/v1/platform/hotels",
        HTTP_HOST=BASE_HOST,
        HTTP_AUTHORIZATION=f"Bearer {admin_token}",
        HTTP_X_FORWARDED_FOR="203.0.113.7, 10.0.0.1",
    )
    assert resp.status_code == 200

    spoofed = client.get(
        "/api/v1/platform/hotels",
        HTTP_HOST=BASE_HOST,
        HTTP_AUTHORIZATION=f"Bearer {admin_token}",
        HTTP_X_FORWARDED_FOR="198.51.100.9, 203.0.113.7",
    )
    assert spoofed.status_code == 401


def test_empty_allowlist_lets_everyone_in(client, admin_token, settings):
    """Пустой список — рубеж выключен: иначе первый запуск запирал бы владельца."""
    settings.PLATFORM_IP_ALLOWLIST = []
    assert _call(client, admin_token, "get", "/hotels").status_code == 200


# --- Аудит -----------------------------------------------------------------


def test_platform_login_and_2fa_are_audited(client, admin_token):
    secret = _call(client, admin_token, "post", "/auth/2fa/setup").json()["secret"]
    _call(client, admin_token, "post", "/auth/2fa/enable", {"code": totp.code_at(secret)})

    with platform_scope():
        actions = list(
            AuditLog.all_objects.using("platform")
            .filter(hotel__isnull=True)
            .values_list("action", flat=True)
        )
    assert "platform.login" in actions
    assert "platform.2fa.enabled" in actions
