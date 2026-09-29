"""
Разовая команда `mark_requested_time_fields`: только флажок, только демо-поля,
выбор администратора сильнее. Замена повторному сиду на стенде — тот
переписывает пароль владельца, категории номеров, фото и расписания.
"""

from __future__ import annotations

from io import StringIO

import pytest
from django.core.management import call_command

from apps.catalog.models import RequestField
from apps.core.context import tenant_context

pytestmark = pytest.mark.django_db


def _run(*args) -> str:
    out = StringIO()
    call_command("mark_requested_time_fields", "--subdomain", "crystal", *args, stdout=out)
    return out.getvalue()


def _marked(crystal) -> set[tuple[str, str]]:
    with tenant_context(crystal):
        return set(
            RequestField.objects.filter(sets_requested_time=True).values_list("item__code", "code")
        )


def _snapshot(crystal) -> dict:
    """Всё, кроме флажка, — чтобы доказать, что команда больше ничего не трогала."""
    with tenant_context(crystal):
        return {
            f.pk: (f.label, f.field_type, f.is_required, f.options, f.sort_order, f.code)
            for f in RequestField.objects.all()
        }


def test_marks_only_the_demo_time_fields_and_nothing_else(crystal):
    with tenant_context(crystal):
        RequestField.objects.update(sets_requested_time=False)
    before = _snapshot(crystal)

    output = _run()

    assert _marked(crystal) == {
        ("laundry-service", "when"),
        ("taxi", "when"),
        ("airport-dropoff", "when"),
        ("flowers", "when"),
    }
    assert _snapshot(crystal) == before, "команда тронула что-то кроме флажка"
    assert "отмечено: 4" in output


def test_second_run_changes_nothing(crystal):
    with tenant_context(crystal):
        RequestField.objects.update(sets_requested_time=False)
    _run()
    assert "отмечено: 0" in _run()


def test_admin_choice_wins_over_the_demo_list(crystal):
    """Администратор сделал сроком другое поле такси — команда его не перетирает."""
    with tenant_context(crystal):
        RequestField.objects.update(sets_requested_time=False)
        RequestField.objects.create(
            hotel=crystal,
            item=RequestField.objects.get(item__code="taxi", code="when").item,
            code="return-at",
            label={"ru": "Когда обратно"},
            field_type="time",
            sets_requested_time=True,
        )
    _run()
    marked = _marked(crystal)
    assert ("taxi", "return-at") in marked and ("taxi", "when") not in marked


def test_dry_run_changes_nothing(crystal):
    with tenant_context(crystal):
        RequestField.objects.update(sets_requested_time=False)
    assert "было бы отмечено: 4" in _run("--dry-run")
    assert _marked(crystal) == set()
