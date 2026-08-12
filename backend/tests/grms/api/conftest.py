"""
Общая оснастка гостевых прогонов управления номером.

Живой стенд поднимается ДОРОГО: демо-конфигурация, эмулятор iRidi в потоке,
коннектор с подпиской на группу. Держать две копии этого в двух файлах значит
однажды починить одну и забыть другую — поэтому фикстуры переехали сюда, а не
скопировались.

Подменён ровно WS-клиент коннектора (tests/grms/grms_harness.py), всё
остальное настоящее: адаптер, транспорт с корреляцией по requestID, эмулятор
с отложенным feedback.
"""

from __future__ import annotations

import pytest

from apps.grms.management.commands.seed_grms_demo import DEMO_ROOM
from tests.grms.grms_harness import GuestClient, _session, wire




@pytest.fixture
def stand(crystal, settings):
    """
    Живой стенд: демо-конфигурация + эмулятор с отложенным feedback + коннектор.

    Демо-конфигурация сеется ЗДЕСЬ, а не приезжает из общего сида отеля.
    Первая версия добавляла её всем — и чужие тесты начали падать на «сколько
    всего типов у отеля», то есть на вопросе про импорт, а не про GRMS. База,
    от которой отсчитывают все остальные, не должна двигаться ради одного
    прогона.
    """
    from django.core.management import call_command

    settings.CELERY_TASK_ALWAYS_EAGER = True
    call_command("seed_grms_demo", subdomain=crystal.subdomain, demo_entry=True, verbosity=0)
    context, finish = wire(crystal)
    yield context
    finish()


@pytest.fixture
def guest(client, crystal, stand):
    return GuestClient(client, crystal, _session(client, crystal))


@pytest.fixture
def queued(monkeypatch, settings):
    """
    Задача НЕ исполняется в запросе — она копится, как в проде.

    Без этой фикстуры доказать асинхронность нечем: в eager-режиме Celery
    выполняет задачу внутри вызова `.delay()`, то есть ровно внутри HTTP-запроса
    гостя, и тест «ответ пришёл быстро» мерил бы не то, что нужно. Здесь вызов
    ЗАПОМИНАЕТСЯ, и тест сам решает, когда его исполнить.
    """
    from apps.grms import tasks

    settings.CELERY_TASK_ALWAYS_EAGER = False
    calls: list[dict] = []
    monkeypatch.setattr(tasks.execute_room_command, "delay", lambda **kw: calls.append(kw))

    class Queue:
        def __init__(self, recorded):
            self.calls = recorded

        def run_all(self):
            while self.calls:
                tasks.execute_room_command(**self.calls.pop(0))

    return Queue(calls)
