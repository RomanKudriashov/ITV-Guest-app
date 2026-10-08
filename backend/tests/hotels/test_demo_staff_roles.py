"""
Разовая команда демо-персонала (партия 48, решение тек-лида 10а).

Холостой прогон ничего не пишет; `--apply` пишет ровно четыре вещи и
идемпотентен; пароль нового повара в вывод не попадает.
"""

from __future__ import annotations

from io import StringIO

import pytest
from django.core.management import call_command

from apps.accounts.models import StaffAssignment, User
from apps.core.context import tenant_context
from apps.hotels.management.commands.demo_staff_roles import _DEMO_PASSWORD, COOK_EMAIL
from apps.hotels.models import ExecutionPoint

pytestmark = pytest.mark.django_db


def _run(*args) -> str:
    out = StringIO()
    call_command("demo_staff_roles", *args, stdout=out)
    return out.getvalue()


@pytest.fixture
def stand_like(crystal):
    """Как на стенде: владелец назначен на кухню, выключенная QA-учётка — на СПА."""
    with tenant_context(crystal):
        owner = User.objects.get(email="owner@crystal.local")
        User.objects.filter(pk=owner.pk).update(full_name="")
        kitchen = ExecutionPoint.objects.get(code="kitchen")
        spa = ExecutionPoint.objects.get(code="spa")
        StaffAssignment.objects.get_or_create(
            user=owner, execution_point=kitchen, defaults={"level": StaffAssignment.Level.MANAGER}
        )
        qa = User.objects.create_user(
            email="qa-e2e-20260924@example.invalid", password="x-not-shown", hotel=crystal, is_staff_member=True
        )
        StaffAssignment.objects.create(
            hotel_id=crystal.pk, user=qa, execution_point=spa, level=StaffAssignment.Level.MEMBER
        )
        User.objects.filter(pk=qa.pk).update(is_active=False)
        return {"owner": owner, "qa": qa, "kitchen": kitchen, "spa": spa}


def _state(crystal, stand_like):
    with tenant_context(crystal):
        cook = User.objects.filter(email=COOK_EMAIL).first()
        return {
            "cook": cook and (cook.full_name, cook.is_active),
            "cook_level": cook
            and StaffAssignment.objects.filter(user=cook, execution_point=stand_like["kitchen"])
            .values_list("level", flat=True)
            .first(),
            "owner_name": User.objects.get(pk=stand_like["owner"].pk).full_name,
            "owner_on_kitchen": StaffAssignment.all_objects.filter(
                user=stand_like["owner"], execution_point=stand_like["kitchen"]
            ).exists(),
            "qa_on_spa": StaffAssignment.all_objects.filter(
                user=stand_like["qa"], execution_point=stand_like["spa"]
            ).exists(),
        }


def test_dry_run_lists_the_changes_and_writes_nothing(crystal, stand_like):
    """УКУС. Без `--apply` — список изменений и ни одной записи."""
    before = _state(crystal, stand_like)
    out = _run()
    assert "ХОЛОСТОЙ ПРОГОН" in out
    for expected in (COOK_EMAIL, "Владелец «Кристалла»", "owner@crystal.local → kitchen", "qa-e2e-20260924"):
        assert expected in out, f"в списке нет «{expected}»:\n{out}"
    assert _state(crystal, stand_like) == before
    assert before["cook"] is None


def test_apply_writes_the_four_changes_and_is_idempotent(crystal, stand_like):
    """УКУС. `--apply` — повар member на кухне, имя владельцу, оба назначения сняты; второй прогон — пусто."""
    _run("--apply")
    after = _state(crystal, stand_like)
    assert after == {
        "cook": ("Алексей, повар", True),
        "cook_level": StaffAssignment.Level.MEMBER,
        "owner_name": "Владелец «Кристалла»",
        "owner_on_kitchen": False,
        "qa_on_spa": False,
    }
    with tenant_context(crystal):
        assert User.objects.get(email=COOK_EMAIL).check_password(_DEMO_PASSWORD)

    again = _run("--apply")
    assert "изменений нет" in again, again
    assert _state(crystal, stand_like) == after


def test_an_owner_who_already_has_a_name_keeps_it(crystal, stand_like):
    with tenant_context(crystal):
        User.objects.filter(pk=stand_like["owner"].pk).update(full_name="Ирина Сергеевна")
    _run("--apply")
    assert _state(crystal, stand_like)["owner_name"] == "Ирина Сергеевна"


def test_the_password_never_reaches_the_output(crystal, stand_like):
    """УКУС. Пароль нового повара — не в вывод ни при холостом прогоне, ни при записи."""
    assert _DEMO_PASSWORD not in _run()
    assert _DEMO_PASSWORD not in _run("--apply")
