"""
Контакты сотрудника: телефон оживлён, мессенджеры — только привязкой.

Телефон — контакт человека, а не отеля: видят его сам сотрудник и
администратор отеля. Кнопка «подключить» без бота честно отвечает «пока
недоступно» — рабочей она не притворяется.
"""

from __future__ import annotations

import pytest

from apps.accounts.models import ContactBindingCode, User
from apps.accounts.services import contacts
from apps.core.context import tenant_context
from apps.core.errors import ValidationError
from apps.core.models import AuditLog
from tests.conftest import CmsClient, staff_token_for

pytestmark = pytest.mark.django_db

CONTACTS = "/api/staff/me/contacts"


@pytest.fixture
def chef(client, crystal):
    """Линейный сотрудник: CMS ему закрыта, свои контакты — нет."""
    return CmsClient(client, crystal, staff_token_for(client, crystal, "chef"))


def _user(crystal, login):
    with tenant_context(crystal):
        return User.objects.get(email=f"{login}@crystal.local")


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("8 (916) 123-45-67", "+79161234567"),
        ("+7 916 123 45 67", "+79161234567"),
        ("+44 20 7946 0958", "+442079460958"),
        ("", ""),
        ("  ", ""),
    ],
)
def test_phone_is_normalised(raw, expected):
    assert contacts.normalize_phone(raw) == expected


@pytest.mark.parametrize("raw", ["12345", "+7 916 abc", "7+916", "+" + "1" * 16])
def test_bad_phone_is_rejected(raw):
    with pytest.raises(ValidationError):
        contacts.normalize_phone(raw)


def test_line_staff_sees_and_edits_own_contacts(chef, crystal):
    response = chef.get(CONTACTS)
    assert response.status_code == 200, response.content
    data = response.json()
    assert set(data["messengers"]) == {"telegram", "max"}
    assert data["messengers"]["telegram"] == {
        "linked": False,
        "confirmed_at": None,
        "username": "",
        "binding_available": False,
    }

    saved = chef.patch(CONTACTS, {"phone": "8 (916) 123-45-67"})
    assert saved.status_code == 200, saved.content
    assert saved.json()["phone"] == "+79161234567"
    assert _user(crystal, "chef").phone == "+79161234567"
    with tenant_context(crystal):
        assert AuditLog.objects.filter(action="staff.contact.phone_changed").exists()

    bad = chef.patch(CONTACTS, {"phone": "12"})
    assert bad.status_code == 422
    assert "invalid_phone" in bad.content.decode()


def test_connect_is_honestly_unavailable_without_a_bot(chef, crystal):
    """Бота нет — кода нет. Заглушка не притворяется работающей."""
    response = chef.post(f"{CONTACTS}/telegram/binding-code")
    assert response.status_code == 409
    assert "binding_unavailable" in response.content.decode()
    with tenant_context(crystal):
        assert not ContactBindingCode.objects.exists()


def test_unknown_messenger_is_rejected(chef, settings):
    settings.CONTACT_BOTS = {"telegram": "itv_test_bot", "max": ""}
    response = chef.post(f"{CONTACTS}/icq/binding-code")
    assert response.status_code == 422


def test_code_is_shown_once_and_only_its_hash_is_kept(chef, crystal, settings):
    settings.CONTACT_BOTS = {"telegram": "itv_test_bot", "max": ""}
    first = chef.post(f"{CONTACTS}/telegram/binding-code")
    assert first.status_code == 200, first.content
    body = first.json()
    code = body["code"]
    assert body["link"] == f"https://t.me/itv_test_bot?start={code}"
    assert len(code) <= 64, "Telegram принимает в start не больше 64 символов"

    with tenant_context(crystal):
        stored = ContactBindingCode.objects.get()
        assert stored.code_hash == contacts.hash_code(code)
        assert code not in (stored.code_hash, stored.external_id)
        assert stored.is_usable

    # Действует только последний код: прежний отзывается.
    chef.post(f"{CONTACTS}/telegram/binding-code")
    with tenant_context(crystal):
        stored.refresh_from_db()
        assert stored.revoked_at is not None
        assert ContactBindingCode.objects.filter(revoked_at__isnull=True).count() == 1


def test_unlink_clears_the_binding(chef, crystal):
    from django.utils import timezone

    with tenant_context(crystal):
        User.objects.filter(email="chef@crystal.local").update(
            telegram_chat_id="100500", telegram_username="petr", telegram_confirmed_at=timezone.now()
        )
    linked = chef.get(CONTACTS).json()["messengers"]["telegram"]
    assert linked["linked"] is True
    assert linked["confirmed_at"]
    assert "100500" not in str(linked), "ID аккаунта наружу не отдаётся"

    after = chef.delete(f"{CONTACTS}/telegram").json()["messengers"]["telegram"]
    assert after["linked"] is False
    assert after["confirmed_at"] is None
    user = _user(crystal, "chef")
    assert (user.telegram_chat_id, user.telegram_username, user.telegram_confirmed_at) == ("", "", None)
    with tenant_context(crystal):
        assert AuditLog.objects.filter(action="staff.contact.unlinked").exists()


# --- Список сотрудников: кто видит телефон -------------------------------------


def _row(page, email):
    return next(item for item in page.json()["items"] if item["email"] == email)


def test_hotel_admin_sees_and_sets_a_phone(cms, crystal):
    cook = _user(crystal, "chef")
    saved = cms.patch(f"/api/cms/staff/{cook.pk}", {"phone": "+7 (903) 000-11-22"})
    assert saved.status_code == 200, saved.content
    assert saved.json()["phone"] == "+79030001122"

    row = _row(cms.get("/api/cms/staff?limit=100"), "chef@crystal.local")
    assert row["phone"] == "+79030001122"
    assert row["messengers"]["telegram"] == {"linked": False, "confirmed_at": None}


def test_a_manager_does_not_see_or_change_phones(cms, cms_manager, crystal):
    cook = _user(crystal, "chef")
    cms.patch(f"/api/cms/staff/{cook.pk}", {"phone": "+79030001122"})

    row = _row(cms_manager.get("/api/cms/staff?limit=100"), "chef@crystal.local")
    assert "phone" not in row, "ключа нет вовсе — даже пустота была бы сведением"
    assert "messengers" in row, "подключён ли мессенджер — управляющему знать нужно"

    denied = cms_manager.patch(f"/api/cms/staff/{cook.pk}", {"phone": "+70000000000"})
    assert denied.status_code == 403
    assert _user(crystal, "chef").phone == "+79030001122"

    # Остальное управляющий правит как прежде — и форма без телефона не мешает.
    renamed = cms_manager.patch(f"/api/cms/staff/{cook.pk}", {"full_name": "Пётр Иванов"})
    assert renamed.status_code == 200, renamed.content
    assert "phone" not in renamed.json()


def test_a_manager_sees_their_own_phone(client, crystal):
    """Свой номер — свой: управляющий видит его и в списке сотрудников."""
    manager = CmsClient(client, crystal, staff_token_for(client, crystal, "manager.restaurant"))
    assert manager.patch(CONTACTS, {"phone": "+79990001122"}).status_code == 200
    me = _user(crystal, "manager.restaurant")
    row = _row(manager.get("/api/cms/staff?limit=100"), me.email)
    assert row["phone"] == "+79990001122"
