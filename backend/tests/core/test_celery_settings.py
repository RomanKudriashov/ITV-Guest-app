"""
Настройка Celery, которой Celery не знает, — ложь в конфиге.

`CELERY_TASK_DEFAULT_RETRY_DELAY = 5` и `CELERY_TASK_MAX_RETRIES = 5` стояли в
настройках и читались как «повтор через пять секунд». Таких ключей у Celery
нет: он молча пропускает их, и пауза оставалась 180 с. Сторож сверяет каждую
`CELERY_*` со списком ключей самого Celery.
"""

from __future__ import annotations

from celery.app import defaults
from django.conf import settings


def _known_keys() -> set[str]:
    return {key for key, _option in defaults.flatten(defaults.NAMESPACES)}


def test_every_celery_setting_is_a_key_celery_knows():
    known = _known_keys()
    assert "task_acks_late" in known, "список ключей Celery пуст — сторож смотрит не туда"

    declared = [name for name in dir(settings) if name.startswith("CELERY_")]
    assert declared, "в настройках нет ни одной CELERY_* — сторож смотрит не туда"
    unknown = [
        name for name in declared if name.removeprefix("CELERY_").lower() not in known
    ]
    assert not unknown, (
        "Celery не знает этих настроек и молча их пропускает: "
        + ", ".join(unknown)
        + ". Повторы и паузы объявляются в самой задаче."
    )


def test_tasks_keep_their_own_retry_policy():
    """Удалённые строки ни на что не влияли: у задач прежние значения."""
    from apps.notifications.tasks import DELIVERY_RETRIES, deliver_event, deliver_notification

    assert deliver_notification.max_retries == DELIVERY_RETRIES
    assert deliver_event.max_retries == DELIVERY_RETRIES
