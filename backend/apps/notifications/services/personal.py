"""
ЛИЧНЫЙ TELEGRAM СОТРУДНИКА ЧЕРЕЗ БОТА ПЛАТФОРМЫ (партия 28).

Привязка (`apps/accounts/services/contacts.py`) заводит сотруднику личный
канал уведомлений — обычный `NotificationChannel` с пометкой
`via_platform_bot`. Дальше он живёт по существующим правилам: события из
справочника, адресаты из настроек событий и ступеней эскалации, текст на языке
получателя. Нового «пути уведомлений» нет — есть ещё один личный канал.

Что здесь:
  * имя бота — из пульса службы, а не из настроек;
  * какие каналы сейчас можно адресовать (выключатель отеля, отвязка,
    блокировка);
  * адрес канала в момент отправки;
  * итог последней отправки — для карточки сотрудника.
"""

from __future__ import annotations

from django.db.models import Q
from django.utils import timezone

from apps.notifications.models import MessengerBotState, NotificationChannel

# Служба опрашивает непрерывно (длинный опрос — 25 с). Три минуты без круга —
# служба стоит, и ссылка «подключить» вела бы в бота, который не ответит.
ALIVE_SECONDS = 180


# --- Бот -----------------------------------------------------------------------


def bot_state(messenger: str = "telegram") -> MessengerBotState | None:
    # Таблица платформенная, без RLS: читается обычным подключением из любого
    # контекста — как пульс службы расписания.
    return MessengerBotState.objects.filter(messenger=messenger).first()


def is_alive(state: MessengerBotState | None) -> bool:
    if state is None or state.last_poll_at is None:
        return False
    return (timezone.now() - state.last_poll_at).total_seconds() <= ALIVE_SECONDS


def bot_username(messenger: str = "telegram") -> str:
    """
    Имя бота, если он на связи, — иначе пусто. Пустое имя и есть «бот не
    подключён»: кнопка «Подключить» выключается, а не ведёт в тишину.
    """
    state = bot_state(messenger)
    if state is None or not state.username or not is_alive(state):
        return ""
    if state.status not in (MessengerBotState.Status.OK, MessengerBotState.Status.ERROR):
        return ""
    return state.username


def bot_health(messenger: str = "telegram") -> dict:
    """Для консоли платформы: жив ли, имя, последний опрос, последняя ошибка. Без токена."""
    state = bot_state(messenger)
    if state is None:
        return {
            "status": MessengerBotState.Status.NO_TOKEN,
            "alive": False,
            "username": "",
            "token_tail": "",
            "last_poll_at": None,
            "age_seconds": None,
            "last_error": "",
            "last_error_at": None,
        }
    age = (
        int((timezone.now() - state.last_poll_at).total_seconds()) if state.last_poll_at else None
    )
    return {
        "status": state.status,
        "alive": is_alive(state),
        "username": state.username,
        "token_tail": state.token_tail,
        "last_poll_at": state.last_poll_at.isoformat() if state.last_poll_at else None,
        "age_seconds": age,
        "last_error": state.last_error,
        "last_error_at": state.last_error_at.isoformat() if state.last_error_at else None,
    }


# --- Отель ---------------------------------------------------------------------


def hotel_allows(hotel_id) -> bool:
    from apps.hotels.models import Hotel

    # `hotels_hotel` — платформенная таблица без RLS: обычное подключение.
    return bool(Hotel.objects.filter(pk=hotel_id).values_list("telegram_enabled", flat=True).first())


def set_hotel_switch(hotel, enabled: bool) -> None:
    from apps.core.models import AuditLog

    if hotel.telegram_enabled == enabled:
        return
    type(hotel).objects.filter(pk=hotel.pk).update(telegram_enabled=enabled, updated_at=timezone.now())
    hotel.telegram_enabled = enabled
    AuditLog.record(
        "notification.telegram_switched",
        object_type="hotel",
        object_id=hotel.pk,
        payload={"enabled": enabled},
    )


def hotel_settings() -> dict:
    """Для экрана уведомлений: выключатель отеля и жив ли бот. Без токена."""
    from apps.hotels.services.hotel import current_hotel

    hotel = current_hotel()
    username = bot_username()
    return {
        "enabled": hotel.telegram_enabled,
        "bot": {"connected": bool(username), "username": username},
    }


# --- Канал ---------------------------------------------------------------------


def channel_title(user) -> str:
    return f"Telegram · {user.full_name or user.email}"[:128]


def ensure_channel(user, *, using: str = "default") -> NotificationChannel:
    """
    Личный канал после привязки: заводится один раз и включается заново при
    повторной привязке — история его доставок остаётся при нём.
    """
    channels = NotificationChannel.all_objects.using(using)
    channel = channels.filter(user_id=user.pk, via_platform_bot=True).first()
    if channel is None:
        return channels.create(
            hotel_id=user.hotel_id,
            user_id=user.pk,
            type="telegram",
            title=channel_title(user),
            via_platform_bot=True,
            is_active=True,
        )
    channel.is_active = True
    channel.blocked_at = None
    channel.title = channel_title(user)
    channel.save(using=using, update_fields=["is_active", "blocked_at", "title", "updated_at"])
    return channel


def disable_channel(user, *, using: str = "default") -> None:
    NotificationChannel.all_objects.using(using).filter(
        user_id=user.pk, via_platform_bot=True
    ).update(is_active=False, updated_at=timezone.now())


def deliverable(queryset):
    """
    Каналы, которым сейчас МОЖНО слать. Отсев — до записи доставки, а не
    отказом при отправке: иначе выключенный отелем Telegram или заблокировавший
    бота сотрудник давали бы по отказу и письму «не доставлено» на каждое
    событие.
    """
    from apps.core.context import current_hotel_id

    queryset = queryset.filter(blocked_at__isnull=True)
    hotel_id = current_hotel_id()
    personal = Q(via_platform_bot=True)
    if hotel_id is not None and not hotel_allows(hotel_id):
        return queryset.exclude(personal)
    # Отвязанный, но почему-то не выключенный канал — адреса нет.
    return queryset.exclude(personal & (Q(user__isnull=True) | Q(user__telegram_chat_id="")))


def config_for(channel: NotificationChannel) -> dict:
    """Адрес — в момент отправки, из привязки: второго места, где лежит chat_id, нет."""
    if not channel.via_platform_bot:
        return channel.config or {}
    # Группа через бота платформы (партия 32) — адрес в конфиге, его ставит бот.
    chat_id = channel.user.telegram_chat_id if channel.user_id else str((channel.config or {}).get("chat_id") or "")
    return {"platform_bot": True, "chat_id": chat_id}


def note_result(channel_id, *, ok: bool, error: str = "", blocked: bool = False) -> None:
    """Итог отправки — на канал: карточка сотрудника показывает его, не листая журнал."""
    if not channel_id:
        return
    now = timezone.now()
    if ok:
        changes = {"last_sent_at": now, "blocked_at": None}
    else:
        changes = {"last_error": str(error or "")[:500], "last_error_at": now}
        if blocked:
            changes["blocked_at"] = now
    NotificationChannel.all_objects.filter(pk=channel_id).update(updated_at=now, **changes)


def unblock_chat(chat_id: str) -> None:
    """Человек написал боту — значит, не заблокировал. Платформенно: отель неизвестен."""
    from apps.accounts.models import User
    from apps.core.context import platform_scope

    with platform_scope():
        user_ids = list(
            User.all_objects.using("platform")
            .filter(telegram_chat_id=str(chat_id))
            .values_list("pk", flat=True)
        )
        if user_ids:
            NotificationChannel.all_objects.using("platform").filter(
                user_id__in=user_ids, via_platform_bot=True, blocked_at__isnull=False
            ).update(blocked_at=None, updated_at=timezone.now())


def delivery_status(user) -> dict:
    """Карточка сотрудника у администратора: последняя доставка, последняя ошибка, блокировка."""
    channel = (
        NotificationChannel.objects.filter(user_id=user.pk, via_platform_bot=True)
        .order_by("-updated_at")
        .first()
    )
    if channel is None:
        return {"last_sent_at": None, "last_error": "", "last_error_at": None, "blocked": False}
    return {
        "last_sent_at": channel.last_sent_at.isoformat() if channel.last_sent_at else None,
        "last_error": channel.last_error,
        "last_error_at": channel.last_error_at.isoformat() if channel.last_error_at else None,
        "blocked": channel.blocked_at is not None,
    }
