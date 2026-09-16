"""
СОБЫТИЕ ОТЕЛЮ — НЕ ПРО ЗАКАЗ.

Движок уведомлений построен вокруг ЗАКАЗА: правило, ступени, эскалация, журнал
со ссылкой на заказ. Это правильно для того, ради чего он сделан, и совершенно
не подходит для «оформление опубликовалось ночью»: заказа нет, эскалировать
нечего, ждать реакции не от кого.

Поэтому здесь отдельная, намеренно маленькая дверь: разослать факт в общие
каналы отеля. Ни правил, ни ступеней, ни повторов — один раз сказали и всё.

ОБЩИЕ КАНАЛЫ — ЭТО КАНАЛЫ БЕЗ ТОЧКИ ИСПОЛНЕНИЯ. Канал, привязанный к кухне,
существует ради кухни; сообщать ей, что администратор поменял цвет витрины, —
шум, а шум учит не читать уведомления вовсе.

ОТКАЗ КАНАЛА НЕ ОТМЕНЯЕТ СОБЫТИЯ. Факт уже записан в журнал вызывающим; здесь
мы лишь пытаемся сказать вслух. Упавший телеграм — это не «публикации не было».
"""

from __future__ import annotations

from apps.notifications import events as notification_events
from apps.notifications.channels.adapters import get_adapter
from apps.notifications.models import NotificationChannel


def announce_to_hotel(event: str, payload: dict) -> int:
    """Разослать факт в общие каналы отеля. Возвращает число каналов."""
    from apps.hotels.services.hotel import current_hotel

    if event not in notification_events.EVENTS:
        return 0

    hotel = current_hotel()
    language = hotel.default_language if hotel else notification_events.FALLBACK_LANGUAGE
    message = notification_events.render(
        event, payload, language=language, default_language=language
    )

    sent = 0
    # ОБЩИЕ каналы — без отдела И без сотрудника. Прежний фильтр брал «всё без
    # отдела» и доставал каждого, у кого есть личный канал.
    channels = NotificationChannel.objects.filter(
        is_active=True, execution_point__isnull=True, user__isnull=True
    )
    for channel in channels:
        try:
            get_adapter(channel.type).send(message, channel.config or {})
            sent += 1
        except Exception:  # noqa: BLE001 — один канал не отменяет остальных
            continue
    return sent
