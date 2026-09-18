"""
Автоперевод: отметки о машинном переводе, прогоны и учёт расхода.

ПРАВКА ЧЕЛОВЕКА СИЛЬНЕЕ МАШИНЫ. Значение, написанное руками, машина не
трогает никогда. Различать их можно только по отметке: в самом поле лежит
строка, и по ней не видно, кто её написал. Поэтому у каждого машинного
значения есть строка здесь — с отпечатком того, что машина записала. Значение
изменилось с тех пор → его правил человек → повторный прогон обходит его
стороной.
"""

from __future__ import annotations

from django.db import models

from apps.core.models import TenantModel


class TranslationMark(TenantModel):
    """Одно машинно переведённое значение: объект, поле, язык, отпечаток."""

    app_label = models.CharField(max_length=64)
    model = models.CharField(max_length=64)
    object_id = models.UUIDField()
    field = models.CharField(max_length=64)
    language = models.CharField(max_length=8)
    # Отпечаток записанного машиной текста: сравнение с текущим значением
    # отвечает на вопрос «правил ли это человек после машины».
    value_hash = models.CharField(max_length=64)
    # Отпечаток исходника: изменился источник — перевод устарел, и его можно
    # обновить, не считая это затиранием чужой работы.
    source_hash = models.CharField(max_length=64)
    characters = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "translate_mark"
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "app_label", "model", "object_id", "field", "language"],
                name="uniq_translation_mark",
            )
        ]
        indexes = [models.Index(fields=["hotel", "language"])]


class TranslationRun(TenantModel):
    """
    Массовый прогон: очередь работы и отчёт по ней.

    Отчёт — не украшение: оператор должен видеть, сколько переведено, сколько
    пропущено и почему, а не «готово».
    """

    class Status(models.TextChoices):
        QUEUED = "queued", "В очереди"
        RUNNING = "running", "Идёт"
        DONE = "done", "Завершён"
        FAILED = "failed", "Ошибка"

    languages = models.JSONField(default=list)
    groups = models.JSONField(default=list)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.QUEUED)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    translated = models.PositiveIntegerField(default=0)
    skipped = models.PositiveIntegerField(default=0)
    failed = models.PositiveIntegerField(default=0)
    characters = models.PositiveIntegerField(default=0)
    # Почему пропустили и где сломалось — по строкам, для отчёта на экране.
    report = models.JSONField(default=dict, blank=True)
    started_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        db_table = "translate_run"
        ordering = ["-created_at"]


class TranslationUsage(TenantModel):
    """
    Расход по месяцам: вызовы и символы.

    БЕЗ УЧЁТА ОДИН ОТЕЛЬ С БОЛЬШИМ КАТАЛОГОМ СЪЕДАЕТ БЮДЖЕТ ВСЕГО ФЛОТА, и
    узнают об этом по счёту. Считаем по месяцам отеля: это тот срок, на
    который выставляют лимит.
    """

    period = models.CharField(max_length=7)  # YYYY-MM
    calls = models.PositiveIntegerField(default=0)
    characters = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "translate_usage"
        constraints = [
            models.UniqueConstraint(fields=["hotel", "period"], name="uniq_translation_usage")
        ]
        ordering = ["-period"]
