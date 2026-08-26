"""
Публикация платформы: применить одно и то же ко многим отелям.

ПОЧЕМУ ЭТО ЗАПИСЬ В БАЗЕ, А НЕ ВЫЗОВ ФУНКЦИИ. Массовое включение отелей —
один `UPDATE` по таблице `Hotel`, которая не тенантная. Публикация контента —
другое дело: тенантные таблицы под RLS, и писать в них можно ТОЛЬКО войдя в
контекст каждого отеля, по одному. Двести отелей — двести транзакций, каждая со
своим исходом: применено, пропущено, отказано. Атомарности здесь нет и быть не
может, значит нужен отчёт — и он должен пережить и запрос, и перезапуск воркера.

СОСТОЯНИЕ ЖИВЁТ ЗДЕСЬ, а не в памяти задачи. Celery-задача — это исполнитель;
она может умереть на сто первом отеле, и тогда единственный, кто знает, что
первые сто уже сделаны, — эта таблица. Отсюда же берётся возобновляемость:
повторный запуск пропускает отели, по которым результат уже записан.

Таблицы ПЛАТФОРМЕННЫЕ, не тенантные. У результата есть `hotel_id`, но читает
его консоль, у которой тенанта нет, и под RLS отчёт молча вернулся бы пустым —
тот самый класс отказа, где «пусто» неотличимо от «нет доступа».
"""

from __future__ import annotations

from django.db import models

from apps.core.models import BaseModel


class PublicationJob(BaseModel):
    """Одна публикация: что публикуем, кому и чем это кончилось."""

    class Scope(models.TextChoices):
        #: Перечисленные отели.
        HOTELS = "hotels", "Выбранные отели"
        #: Состав группы, вычисленный В МОМЕНТ ПРИМЕНЕНИЯ.
        GROUP = "group", "Группа"
        #: Весь флот. Право — только владельческое.
        ALL = "all", "Все отели"

    class Status(models.TextChoices):
        PENDING = "pending", "В очереди"
        RUNNING = "running", "Идёт"
        DONE = "done", "Завершена"
        #: Задача не смогла даже начаться (неизвестный вид, пустая цель).
        FAILED = "failed", "Не выполнена"

    kind = models.SlugField(max_length=64)
    payload = models.JSONField(default=dict, blank=True)

    scope = models.CharField(max_length=16, choices=Scope.choices, default=Scope.HOTELS)
    group = models.ForeignKey(
        "hotels.HotelGroup", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    # Для scope=hotels. Список id, а не M2M: цель публикации — снимок решения
    # оператора, и он не должен меняться, если отель потом удалят.
    hotel_ids = models.JSONField(default=list, blank=True)

    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    actor_id = models.UUIDField(null=True, blank=True)
    # Сколько отелей было в цели на момент ЗАПУСКА. Сверяется с предпросмотром:
    # разошлись — значит состав группы изменился между показом и нажатием, и
    # это надо видеть, а не узнавать по разнице чисел в отчёте.
    planned = models.PositiveIntegerField(default=0)
    error = models.TextField(blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "hotels_publication_job"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"publication:{self.kind}:{self.status}"


class PublicationResult(BaseModel):
    """
    Исход по ОДНОМУ отелю. Строка на отель — это и есть «отчёт по каждому», а
    не «готово».
    """

    class Outcome(models.TextChoices):
        #: Применено: что-то создано или обновлено.
        APPLIED = "applied", "Применено"
        #: Пропущено: у отеля уже ровно то же самое. Повтор не считается работой.
        SKIPPED = "skipped", "Пропущено"
        #: Отказано: отель не принял — нет модуля, не тот тариф, лимит.
        REFUSED = "refused", "Отказано"
        #: Ошибка на нашей стороне. Отдельно от отказа: отказ — это ответ, а
        #: ошибка — это то, что чиним мы.
        FAILED = "failed", "Ошибка"

    job = models.ForeignKey(PublicationJob, on_delete=models.CASCADE, related_name="results")
    hotel = models.ForeignKey("hotels.Hotel", on_delete=models.CASCADE, related_name="+")
    outcome = models.CharField(max_length=16, choices=Outcome.choices)
    # Почему. Пусто только у «применено»: у остальных исходов человек обязан
    # получить причину, а не догадываться по коду.
    detail = models.TextField(blank=True)

    # ПРИЧИНА КОДОМ, а не только словами. Экран обязан отличать «у отеля уже то
    # же самое» от «у отеля своя правка»: первое — ничего не случилось, второе —
    # расхождение, с которым платформа что-то делает. Разбирать текст детали
    # ради этого значило бы сцепить экран с формулировкой.
    reason = models.SlugField(max_length=32, blank=True)

    class Meta:
        db_table = "hotels_publication_result"
        ordering = ["hotel_id"]
        constraints = [
            models.UniqueConstraint(fields=["job", "hotel"], name="uniq_publication_result")
        ]

    def __str__(self) -> str:
        return f"{self.hotel_id}:{self.outcome}"
