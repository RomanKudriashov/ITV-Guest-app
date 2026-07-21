"""
Сервисный слой CMS для уведомлений: каналы, правила эскалации, журнал.

Главное здесь — маскирование секретов. Токен бота можно записать, но нельзя
прочитать: CMS открыта всем сотрудникам отеля, и отдавать наружу креды в
ответе на обычный GET нельзя.
"""

from __future__ import annotations

from typing import Any, Iterable

from django.db import transaction

from apps.core.errors import ConflictError, NotFoundError, ValidationError
from apps.hotels.models import ExecutionPoint

from .channels.adapters import get_adapter
from .models import (
    ChannelType,
    EscalationRule,
    EscalationStep,
    NotificationChannel,
    NotificationLog,
    TargetKind,
)

MASK = "••••"


# --- Каналы ----------------------------------------------------------------


def mask_config(channel: NotificationChannel) -> dict:
    """
    Секреты заменяются на маску с хвостом: «••••1234» позволяет узнать свой
    токен, не раскрывая его.
    """
    adapter = get_adapter(channel.type)
    public: dict[str, Any] = {}
    for key, value in (channel.config or {}).items():
        if key in getattr(adapter, "secret_fields", ()) and value:
            tail = str(value)[-4:]
            public[key] = f"{MASK}{tail}"
        else:
            public[key] = value
    return public


def serialize_channel(channel: NotificationChannel) -> dict:
    return {
        "id": str(channel.pk),
        "type": channel.type,
        "title": channel.title,
        "is_active": channel.is_active,
        "execution_point_id": (
            str(channel.execution_point_id) if channel.execution_point_id else None
        ),
        "user_id": str(channel.user_id) if channel.user_id else None,
        "config_public": mask_config(channel),
        "templates": channel.templates or {},
    }


def list_channels() -> list[dict]:
    return [
        serialize_channel(channel)
        for channel in NotificationChannel.objects.select_related(
            "execution_point", "user"
        ).order_by("title")
    ]


def get_channel(channel_id) -> NotificationChannel:
    channel = NotificationChannel.objects.filter(pk=channel_id).first()
    if channel is None:
        raise NotFoundError("Канал не найден")
    return channel


def _validate_binding(data: dict) -> None:
    point_id = data.get("execution_point_id")
    if point_id and not ExecutionPoint.objects.filter(pk=point_id).exists():
        raise ValidationError("Точка исполнения не найдена", field="execution_point_id")


def _merge_secrets(existing: dict, incoming: dict, adapter) -> dict:
    """
    Пустое или замаскированное значение секрета означает «не менять».

    Иначе форма, где токен показан маской, при сохранении затирала бы настоящий
    токен строкой «••••1234» — классический способ сломать интеграцию правкой
    названия канала.
    """
    merged = dict(incoming or {})
    for key in getattr(adapter, "secret_fields", ()):
        value = str(merged.get(key, "") or "")
        if not value or value.startswith(MASK):
            if existing.get(key):
                merged[key] = existing[key]
            else:
                merged.pop(key, None)
    return merged


@transaction.atomic
def create_channel(data: dict) -> NotificationChannel:
    channel_type = data.get("type") or ChannelType.LOG
    adapter = get_adapter(channel_type)
    _validate_binding(data)

    config = _merge_secrets({}, data.get("config") or {}, adapter)
    adapter.validate_config(config)

    title = (data.get("title") or "").strip()
    if not title:
        raise ValidationError("Укажите название канала", field="title")

    return NotificationChannel.objects.create(
        type=channel_type,
        title=title,
        is_active=data.get("is_active", True),
        execution_point_id=data.get("execution_point_id") or None,
        user_id=data.get("user_id") or None,
        config=config,
        templates=data.get("templates") or {},
    )


@transaction.atomic
def update_channel(channel_id, data: dict) -> NotificationChannel:
    channel = get_channel(channel_id)
    if "type" in data and data["type"] and data["type"] != channel.type:
        raise ValidationError(
            "Тип канала нельзя изменить — создайте новый",
            field="type",
            code="type_immutable",
        )

    adapter = get_adapter(channel.type)
    _validate_binding({**{"execution_point_id": channel.execution_point_id}, **data})

    if "title" in data:
        title = (data["title"] or "").strip()
        if not title:
            raise ValidationError("Укажите название канала", field="title")
        channel.title = title
    if "is_active" in data:
        channel.is_active = data["is_active"]
    if "execution_point_id" in data:
        channel.execution_point_id = data["execution_point_id"] or None
    if "user_id" in data:
        channel.user_id = data["user_id"] or None
    if "templates" in data:
        channel.templates = data["templates"] or {}
    if "config" in data:
        config = _merge_secrets(channel.config or {}, data["config"] or {}, adapter)
        adapter.validate_config(config)
        channel.config = config

    channel.save()
    return channel


@transaction.atomic
def delete_channel(channel_id) -> None:
    get_channel(channel_id).delete()


# --- Правила эскалации -----------------------------------------------------


def serialize_step(step: EscalationStep) -> dict:
    return {
        "id": str(step.pk),
        "sort_order": step.sort_order,
        "delay_minutes": step.delay_minutes,
        "target_kind": step.target_kind,
        "channel_id": str(step.channel_id) if step.channel_id else None,
        "title": step.title,
    }


def serialize_rule(rule: EscalationRule) -> dict:
    return {
        "id": str(rule.pk),
        "name": rule.name,
        "execution_point_id": str(rule.execution_point_id) if rule.execution_point_id else None,
        "is_active": rule.is_active,
        "steps": [serialize_step(step) for step in rule.steps.all()],
    }


def list_rules() -> list[dict]:
    return [
        serialize_rule(rule)
        for rule in EscalationRule.objects.prefetch_related("steps").order_by("name")
    ]


def get_rule(rule_id) -> EscalationRule:
    rule = EscalationRule.objects.prefetch_related("steps").filter(pk=rule_id).first()
    if rule is None:
        raise NotFoundError("Правило не найдено")
    return rule


def _validate_steps(steps: Iterable[dict]) -> list[dict]:
    cleaned = []
    for index, raw in enumerate(steps or []):
        delay = raw.get("delay_minutes", 0)
        if delay is None or int(delay) < 0:
            raise ValidationError(
                "Задержка не может быть отрицательной", field=f"steps.{index}.delay_minutes"
            )
        target_kind = raw.get("target_kind") or TargetKind.POINT
        if target_kind not in dict(TargetKind.choices):
            raise ValidationError(f"Неизвестная цель: {target_kind}", field=f"steps.{index}.target_kind")

        channel_id = raw.get("channel_id") or None
        if target_kind == TargetKind.CHANNEL and not channel_id:
            raise ValidationError(
                "Для этой цели нужно выбрать канал",
                field=f"steps.{index}.channel_id",
                code="channel_required",
            )
        if channel_id and not NotificationChannel.objects.filter(pk=channel_id).exists():
            raise ValidationError("Канал не найден", field=f"steps.{index}.channel_id")

        cleaned.append(
            {
                "sort_order": index,
                "delay_minutes": int(delay),
                "target_kind": target_kind,
                "channel_id": channel_id,
                "title": (raw.get("title") or "").strip()[:128],
            }
        )

    if not cleaned:
        raise ValidationError(
            "Правило без ступеней ничего не сделает", field="steps", code="rule_without_steps"
        )

    delays = [step["delay_minutes"] for step in cleaned]
    if len(set(delays)) != len(delays):
        raise ValidationError(
            "Две ступени с одинаковой задержкой", field="steps", code="duplicate_delay"
        )
    if delays != sorted(delays):
        # Ступени, идущие вразнобой, читаются как ошибка настройки: «через 15,
        # потом через 5» почти наверняка означает перепутанные поля.
        raise ValidationError(
            "Ступени должны идти по возрастанию задержки",
            field="steps",
            code="steps_out_of_order",
        )
    return cleaned


def _check_unique_rule(execution_point_id, exclude_id=None) -> None:
    queryset = EscalationRule.objects.filter(
        execution_point_id=execution_point_id or None, is_active=True
    )
    if exclude_id:
        queryset = queryset.exclude(pk=exclude_id)
    if queryset.exists():
        raise ConflictError(
            "У этой точки исполнения уже есть активное правило",
            code="rule_already_exists",
        )


@transaction.atomic
def create_rule(data: dict) -> EscalationRule:
    name = (data.get("name") or "").strip()
    if not name:
        raise ValidationError("Укажите название правила", field="name")

    steps = _validate_steps(data.get("steps"))
    point_id = data.get("execution_point_id") or None
    if point_id and not ExecutionPoint.objects.filter(pk=point_id).exists():
        raise ValidationError("Точка исполнения не найдена", field="execution_point_id")

    is_active = data.get("is_active", True)
    if is_active:
        _check_unique_rule(point_id)

    rule = EscalationRule.objects.create(
        name=name, execution_point_id=point_id, is_active=is_active
    )
    _replace_steps(rule, steps)
    return get_rule(rule.pk)


@transaction.atomic
def update_rule(rule_id, data: dict) -> EscalationRule:
    rule = get_rule(rule_id)

    if "name" in data:
        name = (data["name"] or "").strip()
        if not name:
            raise ValidationError("Укажите название правила", field="name")
        rule.name = name
    if "execution_point_id" in data:
        rule.execution_point_id = data["execution_point_id"] or None
    if "is_active" in data:
        rule.is_active = data["is_active"]

    if rule.is_active:
        _check_unique_rule(rule.execution_point_id, exclude_id=rule.pk)
    rule.save()

    if "steps" in data:
        # Ступени заменяются набором целиком: редактор всегда присылает полную
        # картину, а дельта-обновления породили бы рассинхрон порядка.
        _replace_steps(rule, _validate_steps(data["steps"]))

    return get_rule(rule.pk)


def _replace_steps(rule: EscalationRule, steps: list[dict]) -> None:
    EscalationStep.objects.filter(rule=rule).hard_delete()
    for step in steps:
        EscalationStep.objects.create(hotel_id=rule.hotel_id, rule=rule, **step)


@transaction.atomic
def delete_rule(rule_id) -> None:
    rule = get_rule(rule_id)
    EscalationStep.objects.filter(rule=rule).delete()
    rule.delete()


# --- Журнал ----------------------------------------------------------------


def serialize_log(entry: NotificationLog) -> dict:
    return {
        "id": str(entry.pk),
        "order_id": str(entry.order_id),
        "order_number": entry.order.number,
        "rule_id": str(entry.rule_id) if entry.rule_id else None,
        "step_id": str(entry.step_id) if entry.step_id else None,
        "step_index": entry.step_index,
        "parent_id": str(entry.parent_id) if entry.parent_id else None,
        "channel_id": str(entry.channel_id) if entry.channel_id else None,
        "channel_type": entry.channel.type if entry.channel_id else "",
        "channel_title": entry.channel.title if entry.channel_id else "",
        "target_kind": entry.target_kind,
        "status": entry.status,
        "scheduled_for": entry.scheduled_for.isoformat() if entry.scheduled_for else None,
        "sent_at": entry.sent_at.isoformat() if entry.sent_at else None,
        "created_at": entry.created_at.isoformat(),
        "attempts": entry.attempts,
        "error": entry.error,
        "subject": entry.subject,
        "body": entry.body,
        "accepted_at_send": entry.accepted_at_send,
    }


def list_logs(*, order_id=None, status: str = "", limit: int = 100) -> list[dict]:
    queryset = NotificationLog.objects.select_related("order", "channel").order_by("-created_at")
    if order_id:
        queryset = queryset.filter(order_id=order_id)
    if status:
        queryset = queryset.filter(status=status)
    return [serialize_log(entry) for entry in queryset[: min(int(limit or 100), 500)]]
