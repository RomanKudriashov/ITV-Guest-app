"""
Сброс второго фактора (партия 60): у потерявшего телефон есть дорога назад.

Владелец — участнику из «Пользователей», себе — нельзя; единственному
владельцу — командой на сервере. Секрет стирается, входы обрываются, в
журнал уходит запись.
"""

from __future__ import annotations

import io

import pytest
from django.core.management import call_command

from apps.accounts.models import User
from apps.core.context import platform_scope
from apps.core.models import AuditLog
from tests.hotels.test_platform_scope import OWNER_EMAIL, _call, _login, owner  # noqa: F401

pytestmark = pytest.mark.django_db(databases=["default", "platform"])


def _member(client, owner, role="support"):  # noqa: F811
    invited = owner("post", "/team", {"email": f"{role}-2fa@platform.test", "role": role}).json()
    with platform_scope():
        User.all_objects.using("platform").filter(pk=invited["member"]["id"]).update(
            totp_enabled=True, totp_secret="JBSWY3DPEHPK3PXP"
        )
    return invited["member"]["id"], invited["password"]


def _user(pk):
    with platform_scope():
        return User.all_objects.using("platform").get(pk=pk)


def test_owner_resets_a_members_second_factor(client, owner):  # noqa: F811
    from apps.accounts.services import sessions as session_svc

    member_id, _ = _member(client, owner)
    session_svc.open_session(_user(member_id), scope="platform")

    done = owner("post", f"/team/{member_id}/2fa/reset")
    assert done.status_code == 200, done.content
    user = _user(member_id)
    assert not user.totp_enabled and user.totp_secret == ""
    assert not session_svc._rows("platform").filter(user_id=member_id, revoked_at__isnull=True).exists()
    with platform_scope():
        assert AuditLog.all_objects.using("platform").filter(action="platform.2fa.reset").exists()


def test_owner_cannot_reset_own_second_factor_from_the_console(client, owner):  # noqa: F811
    with platform_scope():
        me = User.all_objects.using("platform").get(email=OWNER_EMAIL)
    refused = owner("post", f"/team/{me.pk}/2fa/reset")
    assert refused.status_code in (400, 422), refused.content


def test_support_cannot_reset_anyones_second_factor(client, owner):  # noqa: F811
    target_id, _ = _member(client, owner, role="read_only")
    support_id, support_password = _member(client, owner, role="support")
    with platform_scope():
        User.all_objects.using("platform").filter(pk=support_id).update(totp_enabled=False, totp_secret="")
    support = _call(client, _login(client, "support-2fa@platform.test", support_password))
    assert support("post", f"/team/{target_id}/2fa/reset").status_code == 403
    assert _user(target_id).totp_enabled


def test_command_resets_the_second_factor_and_prints_only_the_email(client, owner):  # noqa: F811
    member_id, _ = _member(client, owner)
    out = io.StringIO()
    call_command("reset_platform_2fa", "--email", "support-2fa@platform.test", stdout=out)
    assert out.getvalue().strip() == "сброшено для support-2fa@platform.test"
    assert not _user(member_id).totp_enabled
    with platform_scope():
        row = AuditLog.all_objects.using("platform").filter(action="platform.2fa.reset").latest("created_at")
    assert "reset_platform_2fa" in str(row.payload)
