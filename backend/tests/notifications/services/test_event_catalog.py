"""
Справочник событий уведомлений: полнота и согласованность.

Справочник — код, и ошибки в нём ловятся здесь, а не у получателя: перевод,
которого нет, подстановка, которой событие не приносит, адресат, которого
движок не знает.
"""

from __future__ import annotations

import pytest

from apps.notifications import events

TEXT_FIELDS = ("title", "subject", "body")


@pytest.mark.parametrize("code", sorted(events.EVENTS))
def test_every_text_exists_in_all_four_languages(code):
    spec = events.get(code)
    for field in TEXT_FIELDS:
        values = getattr(spec, field)
        missing = [lang for lang in events.LANGUAGES if not (values.get(lang) or "").strip()]
        assert not missing, f"{code}.{field}: нет перевода на {missing}"


@pytest.mark.parametrize("code", sorted(events.EVENTS))
def test_placeholders_are_declared_and_the_same_in_every_language(code):
    """
    Перевод, потерявший `{{number}}`, пришлёт арабскому руководителю заявку
    без номера — и никто этого не заметит, пока он не спросит.
    """
    spec = events.get(code)
    for field in ("subject", "body"):
        per_language = {
            lang: events.placeholders_in(getattr(spec, field)[lang]) for lang in events.LANGUAGES
        }
        for lang in events.LANGUAGES:
            undeclared = per_language[lang] - set(spec.placeholders)
            assert not undeclared, f"{code}.{field}[{lang}]: подстановки вне списка {undeclared}"
        reference = per_language[events.FALLBACK_LANGUAGE]
        for lang, found in per_language.items():
            assert found == reference, f"{code}.{field}: в {lang} {found}, в ru {reference}"


@pytest.mark.parametrize("code", sorted(events.EVENTS))
def test_audience_is_one_the_engine_knows(code):
    assert events.get(code).audience in events.AUDIENCES


def test_unknown_event_is_a_programming_error():
    with pytest.raises(LookupError):
        events.get("nobody.knows")


def test_language_falls_back_to_the_hotel_then_russian():
    spec = events.get("review.low")
    assert spec.text("subject", "en", "ru").startswith("Low rating")
    assert spec.text("subject", "fr", "en").startswith("Low rating"), "нет языка — берётся язык отеля"
    assert spec.text("subject", "fr", "de").startswith("Низкая оценка"), "нет и его — русский"


def test_missing_value_becomes_a_dash_but_empty_stays_empty():
    assert events.fill("№{{number}} {{comment}}", {"comment": ""}) == "№—"
    assert events.fill("{{comment}}|", {"comment": ""}) == "|"


def test_render_uses_the_requested_language():
    message = events.render(
        "brand.published_on_schedule", {"version": 7}, language="en", default_language="ru"
    )
    assert message.subject == "Branding published"
    assert "version 7" in message.body


@pytest.mark.django_db
def test_brand_events_reach_shared_channels_not_personal_ones(crystal, monkeypatch):
    """
    «Общие каналы отеля» — без отдела И без сотрудника. Прежний фильтр брал всё
    без отдела, и событие оформления получал каждый, у кого есть личный канал:
    на стенде это были все семь адресатов.
    """
    from apps.accounts.models import User
    from apps.core.context import tenant_context
    from apps.notifications.channels import adapters
    from apps.notifications.models import ChannelType, NotificationChannel
    from apps.notifications.services import announce

    with tenant_context(crystal):
        person = User.objects.create(email="owner2@brand.test", hotel=crystal)
        NotificationChannel.objects.create(
            type=ChannelType.LOG, title="личный", user=person, config={"marker": "personal"}
        )
        NotificationChannel.objects.create(
            type=ChannelType.LOG, title="общий", config={"marker": "shared"}
        )

    sent: list[str] = []

    class Recorder:
        def send(self, message, config):
            sent.append(config.get("marker"))
            return "recorded"

    monkeypatch.setattr(adapters, "get_adapter", lambda channel_type: Recorder())

    with tenant_context(crystal):
        announce.announce_to_hotel("brand.published_on_schedule", {"version": 3})

    assert "shared" in sent
    assert "personal" not in sent
