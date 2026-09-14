"""
СЛУЖБА ПРОВЕРКИ: ПРОСЫПАЕТСЯ РАЗ В МИНУТУ.

Отдельный процесс, а не задача Celery по расписанию: источник правды — таблица
назначенных заданий, и всё, что нужно снаружи, — чтобы кто-то регулярно
спрашивал «чему пришёл срок». Простой цикл это делает и не требует ни beat, ни
его состояния, которое пришлось бы хранить и чинить отдельно.

ПАДАТЬ НЕЛЬЗЯ. Круг, упавший на одном отеле, не должен уносить с собой службу:
исключение ловится, пишется в пульс и идёт следующий круг. Иначе одна кривая
строка в одном отеле останавливает публикации всему флоту.

ВИДНА СНАРУЖИ. Каждый круг обновляет пульс — консоль платформы показывает, когда
служба просыпалась в последний раз. Молчащая и работающая службы выглядят
одинаково, если не спрашивать.
"""

from __future__ import annotations

import logging
import signal
import time

from django.core.management.base import BaseCommand

from apps.core.services import scheduler

log = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Выполняет назначенные задания: просыпается раз в интервал и смотрит, чему пришёл срок"

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "--interval",
            type=int,
            default=60,
            help="Секунд между кругами (по умолчанию 60)",
        )
        parser.add_argument(
            "--once",
            action="store_true",
            help="Один круг и выход — для проверок и ручного прогона",
        )

    def handle(self, *args, **options) -> None:
        interval = options["interval"]
        stopping = {"now": False}

        def stop(*_args):
            # Мягкая остановка: доделываем круг и выходим. Прерванный на
            # середине круг оставил бы задание в блокировке до таймаута.
            stopping["now"] = True

        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)

        self.stdout.write(f"Планировщик запущен, круг раз в {interval} с")
        while True:
            try:
                summary = scheduler.tick()
                if summary["done"] or summary["error"]:
                    self.stdout.write(
                        f"круг: выполнено {summary['done']}, ждут {summary['due']}, "
                        f"просрочено {summary['overdue']}"
                        + (f", ошибка: {summary['error']}" if summary["error"] else "")
                    )
            except Exception as exc:  # noqa: BLE001 — служба не имеет права упасть
                log.exception("Круг планировщика не выполнен: %s", exc)

            if options["once"] or stopping["now"]:
                return
            for _ in range(interval):
                if stopping["now"]:
                    return
                time.sleep(1)
