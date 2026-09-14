"""
НАЗНАЧЕННЫЕ ЗАДАНИЯ: ОТЛОЖЕННЫЙ ЗАПУСК, КОТОРОГО В ПРОЕКТЕ НЕ БЫЛО.

ЧТО БЫЛО. Отложить работу было нечем. Celery умеет `countdown` — и им сделаны
короткие задержки: перечитать номер через секунды после команды, эскалация через
минуты. Всё. Планировщика нет ни в коде, ни в compose; отложенный заказ гостя
хранит ВРЕМЯ и показывает его людям — в назначенный час машина не делает ничего.

ПОЧЕМУ `countdown` НЕ ГОДИТСЯ НА СУТКИ. Задача живёт в очереди Redis.
Перезапуск брокера или выкладка её теряют; отменить её по-человечески нельзя,
показать оператору — тоже. «Оформление опубликуется к завтраку» — обещание,
видимое гостям, и выглядеть рабочим оно будет ровно до первой выкладки.

ПОЭТОМУ ИСТОЧНИК ПРАВДЫ — ЭТА ТАБЛИЦА. Служба проверки лишь смотрит, чему
пришёл срок. Умерла служба — задания на месте; перезапустили — подхватит и
выполнит, честно пометив опоздание. Отменили — строка говорит, кто и когда.

ТАБЛИЦА ОБЩАЯ, А НЕ «ПРО БРЕНД». Публикация оформления — первый потребитель;
следом идут отложенные события уведомлений и перевод пачкой. Вид задания
(`kind`) выбирает обработчик, полезная нагрузка лежит в `payload`. Второму
потребителю переделывать нечего: он регистрирует свой вид и пишет свою строку.
"""

from __future__ import annotations

from django.db import models

from apps.core.models import TenantModel


class ScheduledJob(TenantModel):
    """Работа, которую нужно сделать не сейчас, а в названный момент."""

    class Status(models.TextChoices):
        PENDING = "pending", "Ждёт срока"
        DONE = "done", "Выполнено"
        # НЕ СОСТОЯЛАСЬ — это не «ошибка», а исход. Публикация по расписанию не
        # случается, когда за ночь изменилась основа: решение человека больше не
        # относится к тому, что лежит на витрине сейчас.
        SKIPPED = "skipped", "Не состоялась"
        FAILED = "failed", "Сбой"
        CANCELLED = "cancelled", "Отменено"

    kind = models.SlugField(max_length=64, db_index=True)
    payload = models.JSONField(default=dict, blank=True)

    # Момент в UTC. Оператор называет время СВОЕГО отеля, сервер переводит один
    # раз при назначении: хранить местное время значило бы пересчитывать его на
    # каждой проверке и спорить с переводом часов.
    run_at = models.DateTimeField(db_index=True)

    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)

    created_by = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="scheduled_jobs",
    )
    # Имя хранится рядом со ссылкой: человек уволится, запись о нём уберут, а
    # «кто назначил публикацию на ночь» обязано остаться ответом, а не «кто-то».
    created_by_name = models.CharField(max_length=180, blank=True, default="")

    executed_at = models.DateTimeField(null=True, blank=True)
    # НА СКОЛЬКО ОПОЗДАЛИ. Ноль — вовремя. Служба могла стоять, машина —
    # перезагружаться; публикация всё равно случится, и об этом говорят вслух, а
    # не делают вид, что всё по плану.
    delay_seconds = models.PositiveIntegerField(default=0)

    result = models.JSONField(default=dict, blank=True)
    attempts = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "core_scheduled_job"
        ordering = ["run_at"]
        indexes = [
            models.Index(fields=["hotel", "status", "run_at"]),
            models.Index(fields=["status", "run_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.kind} @ {self.run_at.isoformat()} [{self.status}]"


class SchedulerHeartbeat(models.Model):
    """
    ПУЛЬС СЛУЖБЫ: КОГДА ОНА ПРОСЫПАЛАСЬ В ПОСЛЕДНИЙ РАЗ.

    Новая служба в compose — это ещё один процесс, который можно забыть
    перезапустить. У нас уже есть эта грабля: воркер однажды прожил на старом
    коде 39 часов, и без него молча пропадала погода. Молчащая служба и
    работающая служба выглядят одинаково — если не спрашивать.

    Поэтому пульс: строка одна, обновляется на каждом круге. Консоль платформы
    показывает возраст последнего удара, число ждущих и число просроченных —
    и «служба стоит» становится видно нам, а не клиенту.

    Таблица ПЛАТФОРМЕННАЯ: служба одна на весь флот, отеля у неё нет.
    """

    id = models.PositiveSmallIntegerField(primary_key=True, default=1)
    last_tick_at = models.DateTimeField(null=True, blank=True)
    took_ms = models.PositiveIntegerField(default=0)
    due_count = models.PositiveIntegerField(default=0)
    overdue_count = models.PositiveIntegerField(default=0)
    done_last_tick = models.PositiveIntegerField(default=0)
    last_error = models.TextField(blank=True, default="")

    class Meta:
        db_table = "core_scheduler_heartbeat"

    def __str__(self) -> str:
        return f"Пульс планировщика: {self.last_tick_at}"
