"""
ПРЕВЬЮ СОБЫТИЯ: «ВОТ ТАК ПРИДЁТ».

Черновик настройки прикладывается к ПОСЛЕДНЕМУ НАСТОЯЩЕМУ СЛУЧАЮ из данных
отеля и собирается тем же путём, что и отправка: те же подстановки, тот же
выбор текста, те же адресаты на сегодня, каждый на своём языке.

Случая нет — примера нет. Экран говорит «пока не было ни одной отмены», а не
показывает текст про выдуманный заказ: выдуманное превью неотличимо от
настоящего, и человек настраивает не то, что увидит.
"""

from __future__ import annotations

from apps.accounts.services.roles import require_hotel_admin
from apps.core.context import require_hotel_id
from apps.core.fields import translate
from apps.notifications import events as registry
from apps.notifications.services import event_settings, event_values
from apps.notifications.services.events import channels_for_audience, recipient_language, render_for


def preview(code: str, data: dict) -> dict:
    require_hotel_admin()
    from apps.hotels.models import ExecutionPoint, Hotel

    draft = event_settings.draft_from(code, data)
    spec = registry.get(code)
    hotel = Hotel.objects.get(pk=require_hotel_id())
    requested = (data.get("language") or "").strip().lower()
    language = requested if requested in registry.LANGUAGES else hotel.default_language

    example = event_values.find_example(code)
    if example is None:
        return {"enabled": draft.enabled, "example": None, "message": None, "recipients": None}

    point = (
        ExecutionPoint.objects.filter(pk=example.point_id).first() if example.point_id else None
    )
    source = {
        **example.source,
        "point": (translate(point.title, language) or point.code) if point else None,
    }

    if spec.audience_from_rules:
        message, recipients, rule = _escalation(example.order, draft.templates, language, hotel)
    else:
        rule = None
        rendered = registry.render(
            code,
            example.values,
            language=language,
            default_language=hotel.default_language,
            templates=draft.templates,
        )
        message = {"language": language, "subject": rendered.subject, "body": rendered.body}
        recipients = []
        for channel in channels_for_audience(
            draft.audience,
            example.point_id,
            channel_id=draft.channel_id,
            channel_types=draft.channel_types,
        ):
            channel_language, text = render_for(code, example.values, channel, hotel, draft.templates)
            recipients.append(_recipient(channel, channel_language, text.subject, text.body))

    return {
        "enabled": draft.enabled,
        "example": {"source": source},
        "message": message,
        "recipients": recipients,
        "rule": rule,
    }


def _escalation(order, templates: dict, language: str, hotel):
    """Просрочка: адресаты — ступени правила этой заявки, каждая со своим сроком."""
    from apps.notifications.services.delivery import render_message, resolve_channels, rule_for_order

    rendered = render_message(None, order, None, language, templates)
    message = {"language": language, "subject": rendered.subject, "body": rendered.body}

    rule = rule_for_order(order)
    recipients = []
    if rule is not None:
        for step in rule.steps.all().order_by("sort_order", "delay_minutes"):
            for channel in resolve_channels(step, order):
                channel_language = recipient_language(channel, hotel)
                text = render_message(channel, order, step, channel_language, templates)
                recipients.append(
                    {
                        **_recipient(channel, channel_language, text.subject, text.body),
                        "step": {"title": step.title, "delay_minutes": step.delay_minutes},
                    }
                )
    rule_info = {"id": str(rule.pk), "name": rule.name} if rule is not None else None
    return message, recipients, rule_info


def _recipient(channel, language: str, subject: str, body: str) -> dict:
    user = channel.user if channel.user_id else None
    return {
        "channel_id": str(channel.pk),
        "channel_title": channel.title,
        "channel_type": channel.type,
        "recipient": (user.full_name or user.email) if user else None,
        "language": language,
        "subject": subject,
        "body": body,
        "step": None,
    }
