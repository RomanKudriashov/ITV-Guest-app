"""
Платформенное создание отеля: каркас, RLS-изоляция, идемпотентность,
достаточность для логина администратора и открытия витрины.
"""

from __future__ import annotations

import pytest
from django.core.management import CommandError, call_command

from apps.accounts.models import User
from apps.core.context import tenant_context
from apps.core.errors import ConflictError
from apps.hotels.models import ExecutionPoint, Hotel, HotelLanguage
from apps.hotels.provisioning import provision_hotel

pytestmark = pytest.mark.django_db


def _provision(subdomain="alpha", **kw):
    return provision_hotel(
        subdomain=subdomain,
        name=kw.pop("name", "Alpha Hotel"),
        admin_email=kw.pop("admin_email", f"admin@{subdomain}.test"),
        admin_password=kw.pop("admin_password", "secret12345"),
        **kw,
    )


# --- Каркас ----------------------------------------------------------------


def test_scaffold_is_created():
    result = _provision(languages=["en", "ru"], preset="midnight_navy")
    hotel = result.hotel

    assert hotel.subdomain == "alpha"
    assert hotel.default_language == "en"  # первый язык — по умолчанию
    assert hotel.default_theme_id is not None  # бренд-тема назначена

    with tenant_context(hotel):
        langs = {lang.code: lang.is_default for lang in HotelLanguage.objects.all()}
        assert langs == {"en": True, "ru": False}
        assert ExecutionPoint.objects.filter(code="reception").exists()
        admin = User.objects.get(email="admin@alpha.test")
        assert admin.is_hotel_admin and admin.is_staff_member
        assert admin.hotel_id == hotel.pk

    assert result.admin_password == "secret12345"
    assert result.created is True


def test_generated_password_returned_once():
    result = _provision(subdomain="beta", admin_password=None)
    assert result.admin_password  # сгенерирован и возвращён
    assert result.admin.check_password(result.admin_password)


def test_unknown_preset_rejected():
    from apps.core.errors import ValidationError

    with pytest.raises(ValidationError):
        _provision(subdomain="gamma", preset="no_such_preset")


# --- RLS-изоляция ----------------------------------------------------------


def test_new_hotel_invisible_from_another_tenant():
    a = _provision(subdomain="alpha", admin_email="a@alpha.test")
    b = _provision(subdomain="beta", admin_email="b@beta.test")

    # Из-под тенанта B строки отеля A (админ) не видны — RLS изолирует.
    with tenant_context(b.hotel):
        assert not User.objects.filter(email="a@alpha.test").exists()
        assert User.objects.filter(email="b@beta.test").exists()

    with tenant_context(a.hotel):
        assert User.objects.filter(email="a@alpha.test").exists()
        assert not User.objects.filter(email="b@beta.test").exists()


# --- Идемпотентность -------------------------------------------------------


def test_duplicate_subdomain_is_a_clean_error_no_partial_hotel():
    _provision(subdomain="alpha", admin_email="a@alpha.test")
    before = Hotel.objects.count()

    with pytest.raises(ConflictError):
        _provision(subdomain="alpha", admin_email="other@alpha.test")

    # Ни второго отеля, ни второго админа — транзакция откатилась целиком.
    assert Hotel.objects.count() == before
    with tenant_context(Hotel.objects.get(subdomain="alpha")):
        assert not User.objects.filter(email="other@alpha.test").exists()


def test_exist_ok_backfills_idempotently():
    first = _provision(subdomain="alpha", admin_email="a@alpha.test")
    again = provision_hotel(
        subdomain="alpha", name="Alpha Hotel", admin_email="a@alpha.test",
        admin_password="x", exist_ok=True,
    )
    assert again.hotel.pk == first.hotel.pk
    assert Hotel.objects.filter(subdomain="alpha").count() == 1


# --- Достаточность каркаса -------------------------------------------------


def test_scaffold_enough_for_admin_login_and_storefront(client):
    _provision(subdomain="alpha", admin_email="admin@alpha.test", admin_password="secret12345")
    host = "alpha.guest.localhost"

    # Админ логинится в CMS.
    login = client.post(
        "/api/staff/auth/login",
        data={"email": "admin@alpha.test", "password": "secret12345"},
        content_type="application/json",
        HTTP_HOST=host,
    )
    assert login.status_code == 200, login.content
    token = login.json()["access"]

    # CMS-bootstrap отвечает — отель настраиваем.
    boot = client.get("/api/cms/bootstrap", HTTP_HOST=host, HTTP_AUTHORIZATION=f"Bearer {token}")
    assert boot.status_code == 200
    assert boot.json()["hotel"]["subdomain"] == "alpha"

    # Витрина открывается: поддомен резолвится в отель, бренд отдаётся даже на
    # экране «номер не найден» (у нового отеля ещё нет номеров).
    session = client.post(
        "/api/guest/session",
        data={"room_number": "000"},
        content_type="application/json",
        HTTP_HOST=host,
    )
    assert session.status_code == 404
    assert session.json()["hotel"]["subdomain"] == "alpha"


# --- Management-команда -----------------------------------------------------


def test_create_hotel_command(capsys):
    call_command(
        "create_hotel",
        "--subdomain=grand",
        "--name=Grand Hotel",
        "--admin-email=admin@grand.test",
        "--admin-password=grand12345",
    )
    assert Hotel.objects.filter(subdomain="grand").exists()
    out = capsys.readouterr().out
    assert "grand" in out


def test_create_hotel_command_duplicate_errors():
    _provision(subdomain="grand", admin_email="admin@grand.test")
    with pytest.raises(CommandError):
        call_command(
            "create_hotel", "--subdomain=grand", "--name=Grand", "--admin-email=x@grand.test"
        )
