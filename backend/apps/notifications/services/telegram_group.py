"""
ГРУППА TELEGRAM ЧЕРЕЗ БОТА ПЛАТФОРМЫ (партия 32, п.16 решения по QA).

Общий канал уведомлений смены — чат-группа в Telegram. До партии 32 его
заводили «своим ботом»: форма требовала токен и chat_id, которых у отеля нет.
Теперь группу подключает бот платформы:

  1. В панели — «Telegram-группа»: канал заводится в состоянии «ждёт
     подключения», панель получает одноразовый код (30 минут; в базе — только
     отпечаток) и ссылку `t.me/<бот>?startgroup=<код>`.
  2. В группе — `/connect КОД` (или ссылка: Telegram сам добавит бота и пришлёт
     `/start КОД`): канал получает адрес группы, бот отвечает, к чему её
     подключили.
  3. Бота удалили из группы — канал помечается «бот удалён» (`blocked_at`),
     доставки в него не идут; новый код вернёт его.
  4. Удалили канал в панели — бот прощается в группе и выходит из неё.

Группа — обычный канал (`type=telegram`, `via_platform_bot`, без сотрудника):
область — заведение или весь отель, в правилах и событиях участвует как любой
канал. Адрес и код лежат в `config` канала.
"""

from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from apps.core.context import platform_scope
from apps.notifications.models import ChannelType, NotificationChannel

logger = logging.getLogger(__name__)

CODE_TTL = timedelta(minutes=30)
# Без похожих знаков (0/O, 1/I/L): код набирают руками в чате группы.
ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 8

GROUP_CHAT_TYPES = {"group", "supergroup"}


class GroupCodeRejected(Exception):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason  # unknown | expired


def is_group_channel(channel: NotificationChannel) -> bool:
    return channel.type == ChannelType.TELEGRAM and channel.via_platform_bot and not channel.user_id


def _hash(code: str) -> str:
    return hashlib.sha256(code.strip().upper().encode()).hexdigest()


def state_of(channel: NotificationChannel) -> str:
    """pending — ждёт `/connect`; connected — подключена; removed — бота удалили."""
    config = channel.config or {}
    if channel.blocked_at is not None:
        return "removed"
    return "connected" if config.get("chat_id") else "pending"


def public_state(channel: NotificationChannel) -> dict:
    """Что видит панель: состояние, название группы, срок кода — без самого кода."""
    from apps.notifications.services import personal

    config = channel.config or {}
    return {
        "state": state_of(channel),
        "chat_title": config.get("chat_title", ""),
        "code_expires_at": config.get("code_expires_at") or None,
        "bot_username": personal.bot_username(),
    }


def issue_code(channel: NotificationChannel) -> dict:
    """Новый одноразовый код. Прежний гаснет: в базе — один отпечаток."""
    code = "".join(secrets.choice(ALPHABET) for _ in range(CODE_LENGTH))
    expires = timezone.now() + CODE_TTL
    config = dict(channel.config or {})
    config.update({"code_hash": _hash(code), "code_expires_at": expires.isoformat()})
    channel.config = config
    channel.save(update_fields=["config", "updated_at"])
    from apps.notifications.services import personal

    bot = personal.bot_username()
    return {
        "code": code,
        "expires_at": expires.isoformat(),
        "bot_username": bot,
        "link": f"https://t.me/{bot}?startgroup={code}" if bot else "",
    }


@transaction.atomic
def create_group_channel(data: dict) -> tuple[NotificationChannel, dict]:
    """Канал-группа в состоянии «ждёт подключения» и первый код к нему."""
    from apps.core.errors import ValidationError
    from apps.notifications.services.cms import _audit, _channel_state, _validate_binding

    title = (data.get("title") or "").strip()
    if not title:
        raise ValidationError("Укажите название канала", field="title")
    # Область — как у любого канала: заведение или весь отель; у группы нет
    # сотрудника, личный Telegram подключается в профиле.
    binding = {"execution_point_id": data.get("execution_point_id") or None}
    _validate_binding(binding)
    channel = NotificationChannel.objects.create(
        type=ChannelType.TELEGRAM,
        title=title,
        is_active=data.get("is_active", True),
        execution_point_id=binding["execution_point_id"],
        via_platform_bot=True,
        config={"chat_id": "", "chat_title": ""},
        templates=data.get("templates") or {},
    )
    code = issue_code(channel)
    _audit("notification.channel_created", channel, before=None, after=_channel_state(channel))
    return channel, code


def redeem(code: str, *, chat_id: str, chat_title: str) -> NotificationChannel:
    """
    `/connect КОД` в группе. Бот платформенный — отель заранее неизвестен,
    поэтому поиск по отпечатку идёт платформенным подключением.
    """
    digest = _hash(code)
    with platform_scope():
        channel = (
            NotificationChannel.all_objects.using("platform")
            .filter(deleted_at__isnull=True, via_platform_bot=True, user__isnull=True, config__code_hash=digest)
            .select_related("hotel", "execution_point")
            .first()
        )
        if channel is None:
            raise GroupCodeRejected("unknown")
        expires = (channel.config or {}).get("code_expires_at") or ""
        if not expires or expires < timezone.now().isoformat():
            raise GroupCodeRejected("expired")
        config = dict(channel.config or {})
        config.update({"chat_id": str(chat_id), "chat_title": chat_title[:128]})
        config.pop("code_hash", None)
        config.pop("code_expires_at", None)
        NotificationChannel.all_objects.using("platform").filter(pk=channel.pk).update(
            config=config, blocked_at=None, last_error="", updated_at=timezone.now()
        )
        channel.config = config
        channel.blocked_at = None
    _record(channel, "notification.telegram_group_connected", {"chat_title": chat_title[:128]})
    return channel


def _group_channels(chat_id: str):
    return NotificationChannel.all_objects.using("platform").filter(
        deleted_at__isnull=True, via_platform_bot=True, user__isnull=True, config__chat_id=str(chat_id)
    )


def mark_removed(chat_id: str) -> int:
    """Бота удалили из группы: её каналы помечаются, доставки не идут."""
    now = timezone.now()
    with platform_scope():
        channels = list(_group_channels(chat_id))
        for channel in channels:
            NotificationChannel.all_objects.using("platform").filter(pk=channel.pk).update(
                blocked_at=now, last_error="bot_removed", last_error_at=now, updated_at=now
            )
            _record(channel, "notification.telegram_group_removed", {})
    return len(channels)


def migrate(old_chat_id: str, new_chat_id: str) -> int:
    """Группа стала супергруппой — у неё новый адрес; каналы переезжают сами."""
    with platform_scope():
        moved = 0
        for channel in _group_channels(old_chat_id):
            config = dict(channel.config or {})
            config["chat_id"] = str(new_chat_id)
            NotificationChannel.all_objects.using("platform").filter(pk=channel.pk).update(
                config=config, updated_at=timezone.now()
            )
            moved += 1
    return moved


def farewell(channel: NotificationChannel) -> None:
    """Канал удалён в панели: бот прощается в группе и выходит из неё."""
    chat_id = (channel.config or {}).get("chat_id")
    if not chat_id or channel.blocked_at is not None:
        return
    from apps.notifications.messengers import MessengerError, get
    from apps.notifications.messengers.texts import say

    messenger = get("telegram")
    if not messenger.configured():
        return
    try:
        messenger.send(chat_id, "", say("group_farewell", "ru", title=channel.title), [])
        messenger.leave(chat_id)
    except MessengerError as exc:
        logger.info("Группа %s: прощание не ушло: %s", chat_id, exc.detail)


def _record(channel: NotificationChannel, action: str, payload: dict) -> None:
    from apps.core.models import AuditLog

    AuditLog.objects.using("platform").create(
        hotel_id=channel.hotel_id,
        actor_type=AuditLog.ActorType.SYSTEM,
        action=action,
        object_type="notification_channel",
        object_id=channel.pk,
        payload={"name": channel.title, **payload},
    )
