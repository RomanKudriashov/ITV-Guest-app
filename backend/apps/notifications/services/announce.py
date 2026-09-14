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

from apps.notifications.channels.adapters import get_adapter
from apps.notifications.channels.base import RenderedMessage
from apps.notifications.models import NotificationChannel

# Тексты короткие и по делу: их читают в мессенджере, часто ночью.
TEXTS = {
    "brand.published_on_schedule": (
        "Оформление опубликовано",
        "Назначенная публикация состоялась: версия {version}.",
    ),
    "brand.published_late": (
        "Оформление опубликовано с задержкой",
        "Назначенная публикация состоялась позже срока на {delay_seconds} с: версия {version}.",
    ),
    "brand.schedule_failed": (
        "Публикация оформления не состоялась",
        "Черновик «{draft_name}» не опубликован: за время ожидания оформление "
        "изменил кто-то другой. Черновик сохранён — откройте его и решите, что делать.",
    ),
}


def announce_to_hotel(event: str, payload: dict) -> int:
    """Разослать факт в общие каналы отеля. Возвращает число каналов."""
    template = TEXTS.get(event)
    if template is None:
        return 0

    subject, body = template
    message = RenderedMessage(subject=subject, body=body.format(**_defaults(payload)))

    sent = 0
    channels = NotificationChannel.objects.filter(is_active=True, execution_point__isnull=True)
    for channel in channels:
        try:
            get_adapter(channel.type).send(message, channel.config or {})
            sent += 1
        except Exception:  # noqa: BLE001 — один канал не отменяет остальных
            continue
    return sent


def _defaults(payload: dict) -> dict:
    """
    Пропуски заполняются прочерком, а не ломают сообщение.

    Текст без одного поля всё равно несёт главное — что случилось; исключение
    в форматировании не несёт ничего.
    """
    filled = {"version": "—", "draft_name": "—", "delay_seconds": 0}
    filled.update({key: value for key, value in payload.items() if value is not None})
    return filled
