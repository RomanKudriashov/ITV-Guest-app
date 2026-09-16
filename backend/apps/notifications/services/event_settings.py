"""
Настройки событий: что отель решил про события справочника.

Строки нет — действует значение справочника: включено только то, что требует
действия, адресат — справочника, каналы — любые, текст — справочника.

Меняет настройку администратор отеля: события вроде «уведомление не
доставлено» и события оформления — уровень отеля, и выключить отмены целому
отделу не должен управляющий соседнего.
"""

from __future__ import annotations

import dataclasses

from django.db import transaction

from apps.accounts.services.roles import require_hotel_admin
from apps.core.errors import NotFoundError, ValidationError
from apps.core.models import AuditLog
from apps.notifications import events as registry
from apps.notifications.models import ChannelType, EventSetting, NotificationChannel

AUDIENCE_CHANNEL = "channel"
AUDIENCES = (*registry.AUDIENCES, AUDIENCE_CHANNEL)
SUBJECT_MAX = 255
BODY_MAX = 4000


@dataclasses.dataclass(frozen=True, slots=True)
class Effective:
    code: str
    enabled: bool
    audience: str
    channel_id: str | None
    channel_types: tuple[str, ...]
    templates: dict
    # Отель что-то менял — есть строка настройки.
    customized: bool


def effective(code: str, setting: EventSetting | None = None) -> Effective:
    spec = registry.get(code)
    if setting is None:
        setting = EventSetting.objects.filter(code=code).first()
    if setting is None:
        return Effective(
            code=code,
            enabled=spec.enabled_by_default,
            audience=spec.audience,
            channel_id=None,
            channel_types=(),
            templates={},
            customized=False,
        )
    return Effective(
        code=code,
        enabled=setting.is_enabled,
        audience=setting.audience or spec.audience,
        channel_id=str(setting.channel_id) if setting.channel_id else None,
        channel_types=tuple(setting.channel_types or ()),
        templates=setting.templates or {},
        customized=True,
    )


def is_enabled(code: str) -> bool:
    return effective(code).enabled


# --- Экран -----------------------------------------------------------------


def list_settings(language: str) -> dict:
    stored = {setting.code: setting for setting in EventSetting.objects.all()}
    items = []
    for entry in registry.catalog(language):
        current = effective(entry["code"], stored.get(entry["code"]))
        items.append({**entry, "setting": serialize(current)})
    return {"items": items}


def serialize(current: Effective) -> dict:
    return {
        "enabled": current.enabled,
        "audience": current.audience,
        "channel_id": current.channel_id,
        "channel_types": list(current.channel_types),
        "templates": current.templates,
        "customized": current.customized,
    }


# --- Проверка и сохранение ---------------------------------------------------


def draft_from(code: str, data: dict) -> Effective:
    """
    Черновик настройки из формы — ПРОВЕРЕННЫЙ. Один и тот же для сохранения и
    для превью: превью, которое принимает то, что сохранение отвергнет,
    показывало бы сообщение, которого никогда не будет.
    """
    spec = _spec_or_404(code)
    base = effective(code)

    enabled = bool(data.get("enabled", base.enabled))
    audience = data.get("audience", base.audience) or spec.audience
    channel_id = data.get("channel_id", base.channel_id) or None
    channel_types = tuple(data.get("channel_types", base.channel_types) or ())
    templates = data.get("templates", base.templates) or {}

    if spec.audience_from_rules:
        # Кому уходит просрочка, решают ступени эскалации. Две настройки одного
        # и того же давали бы вопрос «какая главнее» без ответа на экране.
        if audience != spec.audience or channel_id or channel_types:
            raise ValidationError(
                "Кому уходит это событие, задают правила эскалации",
                field="audience",
                code="audience_from_rules",
            )
    if audience not in AUDIENCES:
        raise ValidationError("Неизвестный адресат", field="audience", code="invalid_audience")
    if audience == AUDIENCE_CHANNEL:
        if not channel_id:
            raise ValidationError("Выберите канал", field="channel_id", code="channel_required")
        if not _channel_exists(channel_id):
            raise ValidationError("Канал не найден", field="channel_id", code="channel_not_found")
    else:
        channel_id = None
    unknown_types = [kind for kind in channel_types if kind not in ChannelType.values]
    if unknown_types:
        raise ValidationError(
            f"Неизвестный вид канала: {', '.join(map(str, unknown_types))}",
            field="channel_types",
            code="invalid_channel_type",
        )

    return Effective(
        code=code,
        enabled=enabled,
        audience=audience,
        channel_id=channel_id,
        channel_types=tuple(dict.fromkeys(channel_types)),
        templates=_clean_templates(spec, templates),
        customized=True,
    )


def save(code: str, data: dict) -> dict:
    """
    Сохранить решение отеля. Решение, совпавшее со справочником, строку
    УДАЛЯЕТ: «вернуть по умолчанию» значит снова следовать справочнику, в том
    числе его будущим изменениям, а не застыть на сегодняшней копии.
    """
    require_hotel_admin()
    draft = draft_from(code, data)
    spec = registry.get(code)
    before = effective(code)
    as_registry = (
        draft.enabled == spec.enabled_by_default
        and draft.audience == spec.audience
        and not draft.channel_id
        and not draft.channel_types
        and not draft.templates
    )

    with transaction.atomic():
        setting = None
        if as_registry:
            existing = EventSetting.objects.filter(code=code).first()
            if existing is not None:
                existing.delete(hard=True)
        else:
            setting, _ = EventSetting.objects.update_or_create(
                code=code,
                defaults={
                    "is_enabled": draft.enabled,
                    "audience": draft.audience,
                    "channel_id": draft.channel_id,
                    "channel_types": list(draft.channel_types),
                    "templates": draft.templates,
                },
            )
        changes = sorted(
            field
            for field in ("enabled", "audience", "channel_id", "channel_types", "templates")
            if getattr(before, field) != getattr(draft, field)
        )
        if changes:
            AuditLog.record(
                "notification.event_settings_changed",
                object_type="notification_event",
                object_id=setting.pk if setting else None,
                payload={
                    "code": code,
                    "changes": changes,
                    "enabled": draft.enabled,
                    "as_registry": as_registry,
                },
            )
    return serialize(effective(code, setting))


def _clean_templates(spec: registry.EventSpec, templates) -> dict:
    """
    Текст отеля: известные языки, известные подстановки, разумная длина.

    Неизвестная подстановка — ошибка при СОХРАНЕНИИ, а не прочерк в сообщении:
    опечатку в `{{numbr}}` отель должен увидеть на экране, а не узнать от
    старшего смены, которому пришло «Заявка №—».
    """
    if not isinstance(templates, dict):
        raise ValidationError("Тексты — объект по языкам", field="templates")
    cleaned: dict[str, dict[str, str]] = {}
    allowed = set(spec.placeholders)
    for language, entry in templates.items():
        if language not in registry.LANGUAGES:
            raise ValidationError(
                f"Неизвестный язык «{language}»", field="templates", code="invalid_language"
            )
        if not isinstance(entry, dict):
            raise ValidationError("Текст — тема и сообщение", field=f"templates.{language}")
        subject = str(entry.get("subject") or "").strip()
        body = str(entry.get("body") or "").strip()
        for name, value, limit in (("subject", subject, SUBJECT_MAX), ("body", body, BODY_MAX)):
            if len(value) > limit:
                raise ValidationError(
                    f"Не длиннее {limit} символов",
                    field=f"templates.{language}.{name}",
                    code="too_long",
                )
            unknown = sorted(registry.placeholders_in(value) - allowed)
            if unknown:
                raise ValidationError(
                    "Неизвестная подстановка: " + ", ".join("{{" + item + "}}" for item in unknown),
                    field=f"templates.{language}.{name}",
                    code="unknown_placeholder",
                )
        if subject or body:
            if not subject or not body:
                # Половина текста отеля и половина справочника — сообщение,
                # которого никто не писал целиком.
                raise ValidationError(
                    "Нужны и тема, и сообщение — или оставьте оба пустыми",
                    field=f"templates.{language}.{'subject' if not subject else 'body'}",
                    code="template_incomplete",
                )
            cleaned[language] = {"subject": subject, "body": body}
    return cleaned


def _spec_or_404(code: str) -> registry.EventSpec:
    try:
        return registry.get(code)
    except LookupError:
        raise NotFoundError("Такого события нет") from None


def _channel_exists(channel_id) -> bool:
    from django.core.exceptions import ValidationError as DjangoValidationError

    try:
        return NotificationChannel.objects.filter(pk=channel_id, is_active=True).exists()
    except (DjangoValidationError, ValueError, TypeError):
        return False
