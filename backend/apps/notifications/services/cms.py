"""
Сервисный слой CMS для уведомлений: каналы, правила эскалации, журнал.

Главное здесь — маскирование секретов. Токен бота можно записать, но нельзя
прочитать: CMS открыта всем сотрудникам отеля, и отдавать наружу креды в
ответе на обычный GET нельзя.
"""

from __future__ import annotations

from typing import Any, Iterable

from django.db import transaction

from apps.accounts.models import User
from apps.accounts.services.roles import (
    managed_point_ids_or_none,
    require_hotel_admin,
    require_point_scope,
)
from apps.core.errors import ConflictError, NotFoundError, ValidationError
from apps.hotels.models import ExecutionPoint

from apps.notifications.channels.adapters import get_adapter
from apps.notifications.models import (
    ChannelType,
    EscalationRule,
    EscalationStep,
    NotificationChannel,
    NotificationLog,
    TargetKind,
)

MASK = "••••"


# --- Каналы ----------------------------------------------------------------


def _require_point(point_id, what: str) -> None:
    """
    Канал и правило привязаны к отделу — им распоряжается его управляющий.
    Привязка к NULL (правило отеля по умолчанию, общий канал) — уровень отеля.
    """
    if point_id is None:
        require_hotel_admin()
        return
    require_point_scope(point_id, what=what)


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


def list_channels(*, search: str = "", limit: int | None = None, offset: int = 0) -> dict:
    queryset = NotificationChannel.objects.select_related("execution_point", "user")
    managed = managed_point_ids_or_none()
    if managed is not None:
        # Канал управляющего — канал его отдела либо его собственный. Личные
        # каналы чужих людей и общеотельные ему не показываем.
        queryset = queryset.filter(execution_point_id__in=managed)
    # Канал ищут по названию — оно и есть то, что о нём помнят.
    from apps.core.listing import page as list_page, search as apply_search

    queryset = apply_search(queryset.order_by("title"), search, ("title",))
    return list_page(queryset, limit=limit, offset=offset, serialize=serialize_channel)


def get_channel(channel_id) -> NotificationChannel:
    channel = NotificationChannel.objects.filter(pk=channel_id).first()
    if channel is None:
        raise NotFoundError("Канал не найден")
    _require_point(channel.execution_point_id, "Канал")
    return channel


def _validate_binding(data: dict) -> None:
    point_id = data.get("execution_point_id")
    if point_id and not _exists(ExecutionPoint, point_id):
        raise ValidationError("Заведение не найдено", field="execution_point_id")
    _require_point(point_id, "Канал")

    # Сотрудника проверяем ровно так же, как заведение. Без этого несуществующий
    # `user_id` доезжал до INSERT и падал IntegrityError'ом, а кривой — ломался
    # ещё раньше, на разборе UUID: и то и другое отель видел пятисоткой вместо
    # внятного «сотрудник не найден».
    user_id = data.get("user_id")
    if user_id and not _exists(User, user_id, is_staff_member=True):
        raise ValidationError("Сотрудник не найден", field="user_id")


def _exists(model, pk, **extra) -> bool:
    """
    `exists()` с непригодным pk — не 500.

    Значение приходит из формы, и «не-UUID» — такая же пользовательская ошибка,
    как «не тот UUID»: обе обязаны стать 422, а не трейсбеком.
    """
    from django.core.exceptions import ValidationError as DjangoValidationError

    try:
        return model.objects.filter(pk=pk, **extra).exists()
    except (DjangoValidationError, ValueError, TypeError):
        return False


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


def list_rules(*, search: str = "", limit: int | None = None, offset: int = 0) -> dict:
    queryset = EscalationRule.objects.prefetch_related("steps")
    managed = managed_point_ids_or_none()
    if managed is not None:
        queryset = queryset.filter(execution_point_id__in=managed)
    # Правило ищут по названию — больше у него ничего запоминающегося нет.
    from apps.core.listing import page as list_page, search as apply_search

    queryset = apply_search(queryset.order_by("name"), search, ("name",))
    return list_page(queryset, limit=limit, offset=offset, serialize=serialize_rule)


def get_rule(rule_id) -> EscalationRule:
    rule = EscalationRule.objects.prefetch_related("steps").filter(pk=rule_id).first()
    if rule is None:
        raise NotFoundError("Правило не найдено")
    _require_point(rule.execution_point_id, "Правило эскалации")
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
        raise ValidationError("Заведение не найдено", field="execution_point_id")
    _require_point(point_id, "Правило эскалации")

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


def _order_filter(value):
    """
    Заказ ищут ТЕМ, ЧТО ВИДЯТ, — номером.

    В таблице журнала заказ показан номером («№90768»), поле подписано «Заказ»,
    а сервер ждал UUID: набранный из таблицы номер уходил в UUID-поле и
    возвращался пятисоткой. Поэтому здесь принимается и то и другое:

      * UUID — как было, ссылки и внутренние переходы им и пользуются;
      * номер (с «№», «#» и пробелами вокруг — их отель наберёт вместе с
        цифрами) — то, что человек копирует глазами из строки.

    Заведомо непригодная строка не ошибка запроса, а пустой результат: журнал
    отвечает «по такому заказу отправок нет», а не показывает всё подряд.
    """
    import uuid

    from django.db.models import Q

    raw = str(value).strip().lstrip("№#").strip()
    if not raw:
        return Q()
    try:
        return Q(order_id=uuid.UUID(raw))
    except (ValueError, AttributeError, TypeError):
        pass
    if raw.isdigit():
        return Q(order__number=int(raw))
    # Ни UUID, ни номер: совпасть не с чем, и молчаливое «показали всё» здесь
    # было бы худшим ответом — фильтр обязан отфильтровывать.
    return Q(pk=None)


def list_logs(
    *, order_id=None, status: str = "", search: str = "", limit: int | None = None, offset: int = 0
) -> dict:
    """Журнал отправок: фильтр по заказу и статусу был, поиск по адресату — нет."""
    from apps.core.listing import page as list_page, search as apply_search

    queryset = NotificationLog.objects.select_related("order", "channel").order_by("-created_at")

    # РЕЖЕМ ПО ТОЧКЕ ЗАКАЗА, А НЕ ПО ПРАВИЛУ И НЕ ПО КАНАЛУ.
    #
    # Журнал не резался вовсе: управляющий кухней видел отправки всего отеля —
    # 100 записей, посимвольно те же, что у владельца. Каналы и правила рядом
    # режутся `managed_point_ids_or_none()`, а журнал эту строку потерял.
    #
    # Признак выбран так, чтобы он был у КАЖДОЙ записи и отвечал на вопрос
    # «чья это заявка». Замер на стенде: заказ есть у всех 7993 записей (связь
    # обязательна в модели), правило — тоже у всех, но правило бывает
    # общеотельным (`execution_point=NULL` модель допускает), и по нему чужая
    # заявка уехала бы всем. Канала нет у 5050 записей (родительская запись
    # «ступень сработала» канала не несёт), а у 1203 канал личный, без точки, —
    # по нему половина журнала просто исчезла бы из виду.
    managed = managed_point_ids_or_none()
    if managed is not None:
        queryset = queryset.filter(order__execution_point_id__in=managed)

    if order_id:
        queryset = queryset.filter(_order_filter(order_id))
    if status:
        queryset = queryset.filter(status=status)
    queryset = apply_search(queryset, search, ("channel__title", "target_kind"))
    return list_page(queryset, limit=limit, offset=offset, serialize=serialize_log)


# --- Журнал событий --------------------------------------------------------


def serialize_event(record) -> dict:
    return {
        "id": str(record.pk),
        "code": record.code,
        "execution_point_id": str(record.execution_point_id) if record.execution_point_id else None,
        "payload": record.payload or {},
        "outcome": record.outcome,
        "created_at": record.created_at.isoformat(),
        "deliveries": [
            {
                "id": str(delivery.pk),
                "channel_id": str(delivery.channel_id) if delivery.channel_id else None,
                "channel_type": delivery.channel_type,
                "channel_title": delivery.channel_title,
                "recipient_id": str(delivery.recipient_id) if delivery.recipient_id else None,
                "language": delivery.language,
                "subject": delivery.subject,
                "body": delivery.body,
                "status": delivery.status,
                "attempts": delivery.attempts,
                "sent_at": delivery.sent_at.isoformat() if delivery.sent_at else None,
                "error": delivery.error,
            }
            for delivery in record.deliveries.all()
        ],
    }


def list_events(
    *, code: str = "", outcome: str = "", limit: int | None = None, offset: int = 0
) -> dict:
    """
    Журнал событий. Режется так же, как журнал эскалации: управляющий видит
    события своих отделов. Событие уровня отеля (без отдела — оформление)
    видит только администратор отеля: у управляющего кухней к нему отношения
    нет, а его текст может нести то, что отдел знать не должен.
    """
    from apps.core.listing import page as list_page
    from apps.notifications.models import EventRecord

    queryset = EventRecord.objects.prefetch_related("deliveries").order_by("-created_at")
    managed = managed_point_ids_or_none()
    if managed is not None:
        queryset = queryset.filter(execution_point_id__in=managed)
    if code:
        queryset = queryset.filter(code=code)
    if outcome:
        queryset = queryset.filter(outcome=outcome)
    return list_page(queryset, limit=limit, offset=offset, serialize=serialize_event)


def event_catalog(language: str) -> dict:
    """Справочник событий — для экрана настроек и для фильтра журнала."""
    from apps.notifications import events as registry

    return {"items": registry.catalog(language)}
