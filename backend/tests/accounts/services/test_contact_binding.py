"""
Обмен одноразового кода привязки — со стороны бота.

Бот один на все отели и заранее не знает, чей код ему прислали, поэтому обмен
идёт платформенным подключением. Отсюда `transaction=True`: код, записанный
транзакцией теста, другое подключение иначе не увидело бы.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.accounts.models import ContactBindingCode, User
from apps.accounts.services import contacts
from apps.core.context import tenant_context
from apps.core.models import AuditLog

pytestmark = pytest.mark.django_db(transaction=True, databases=["default", "platform"])


@pytest.fixture(autouse=True)
def bot(settings):
    settings.CONTACT_BOTS = {"telegram": "itv_test_bot", "max": "itv_max_bot"}


def _issue(hotel, email, messenger="telegram"):
    with tenant_context(hotel):
        user = User.objects.get(email=email)
        return user, contacts.issue_code(user, messenger)["code"]


def test_a_code_binds_the_account_and_is_spent(crystal):
    user, code = _issue(crystal, "chef@crystal.local")

    # Вне контекста отеля — как у бота.
    bound = contacts.redeem_code("telegram", code, external_id="100500", username="petr")
    assert bound.pk == user.pk
    assert bound.telegram_chat_id == "100500"
    assert bound.telegram_username == "petr"
    assert bound.telegram_confirmed_at is not None

    with pytest.raises(contacts.BindingRejected) as again:
        contacts.redeem_code("telegram", code, external_id="100500")
    assert again.value.reason == "used"

    with tenant_context(crystal):
        spent = ContactBindingCode.objects.get(user=user)
        assert spent.used_at is not None
        assert spent.external_id == "100500"
        assert AuditLog.objects.filter(action="staff.contact.linked", object_id=user.pk).exists()


def test_max_binds_its_own_fields(crystal):
    user, code = _issue(crystal, "chef@crystal.local", "max")
    bound = contacts.redeem_code("max", code, external_id="777")
    assert (bound.max_user_id, bound.telegram_chat_id) == ("777", "")
    assert bound.max_confirmed_at is not None
    with pytest.raises(contacts.BindingRejected) as wrong:
        contacts.redeem_code("telegram", code, external_id="777")
    assert wrong.value.reason == "unknown", "код Max не обменивается в Telegram"


@pytest.mark.parametrize(
    ("spoil", "reason"),
    [
        (lambda row: row.update(expires_at=timezone.now() - timedelta(seconds=1)), "expired"),
        (lambda row: row.update(revoked_at=timezone.now()), "revoked"),
    ],
)
def test_a_stale_code_does_not_bind(crystal, spoil, reason):
    user, code = _issue(crystal, "chef@crystal.local")
    with tenant_context(crystal):
        spoil(ContactBindingCode.objects.filter(user=user))
    with pytest.raises(contacts.BindingRejected) as rejected:
        contacts.redeem_code("telegram", code, external_id="1")
    assert rejected.value.reason == reason
    assert User.all_objects.using("platform").get(pk=user.pk).telegram_chat_id == ""


def test_an_unknown_code_does_not_bind(crystal):
    with pytest.raises(contacts.BindingRejected) as rejected:
        contacts.redeem_code("telegram", "nope", external_id="1")
    assert rejected.value.reason == "unknown"


def test_one_account_cannot_serve_two_employees(crystal):
    """Иначе сообщения одного сотрудника уходили бы другому."""
    _, first = _issue(crystal, "chef@crystal.local")
    contacts.redeem_code("telegram", first, external_id="42")
    _, second = _issue(crystal, "maid@crystal.local")
    with pytest.raises(contacts.BindingRejected) as rejected:
        contacts.redeem_code("telegram", second, external_id="42")
    assert rejected.value.reason == "taken"


def test_an_inactive_employee_cannot_be_bound(crystal):
    user, code = _issue(crystal, "chef@crystal.local")
    User.all_objects.using("platform").filter(pk=user.pk).update(is_active=False)
    with pytest.raises(contacts.BindingRejected) as rejected:
        contacts.redeem_code("telegram", code, external_id="1")
    assert rejected.value.reason == "inactive"


def test_codes_are_isolated_between_hotels(crystal, aurora):
    _issue(crystal, "chef@crystal.local")
    with tenant_context(aurora):
        assert not ContactBindingCode.objects.exists()
