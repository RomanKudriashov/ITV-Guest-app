"""
СОБЫТИЕ ОТЕЛЮ — НЕ ПРО ЗАКАЗ.

Движок эскалации построен вокруг ЗАКАЗА и для «оформление опубликовалось
ночью» не подходит: заказа нет, эскалировать нечего. Такие события идут
через общую дверь `services/events.notify`: факт — в журнал событий, текст —
из справочника, адресат по умолчанию — общие каналы отеля (без отдела и без
сотрудника).

ОТКАЗ КАНАЛА НЕ ОТМЕНЯЕТ СОБЫТИЯ: упавший телеграм — это не «публикации не
было»; он остаётся в журнале доставкой со статусом `failed`.
"""

from __future__ import annotations

from apps.notifications import events as notification_events


def announce_to_hotel(event: str, payload: dict) -> int:
    """
    Разослать факт в общие каналы отеля — через журнал событий.

    Возвращает, во сколько каналов событие поставлено в отправку. Отправляет
    Celery после коммита: здесь, под блокировкой задания службы расписания,
    ждать чужой API нельзя.
    """
    from apps.notifications.services.events import notify

    from apps.notifications.services import event_values

    if event not in notification_events.EVENTS:
        return 0
    record = notify(event, event_values.brand(payload))
    if record is None:
        return 0
    return record.deliveries.count()
