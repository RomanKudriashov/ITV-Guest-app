"""
СЛУЖБА ОТЛОЖЕННОГО ЗАПУСКА.

ЧТО ЗДЕСЬ. Назначить работу на срок, отменить до срабатывания, и круг проверки,
который смотрит, чему срок пришёл. Сама работа здесь НЕ делается: вид задания
выбирает обработчик, зарегистрированный тем приложением, которому эта работа
принадлежит. Публикация оформления — первый потребитель, и знать о нём
планировщику незачем.

ПОЧЕМУ КРУГ ХОДИТ ПО ОТЕЛЯМ, А НЕ ОДНИМ ЗАПРОСОМ ПО ВСЕМУ ФЛОТУ. Таблица
тенантная и закрыта RLS — по доводу, который мы уже оплатили дважды: в задании
лежит решение отеля о будущем виде его витрины. Прочитать её «сразу за всех»
можно было бы, сняв политику; вместо этого круг входит в контекст каждого отеля
по очереди. Двести отелей — двести дешёвых запросов по индексу раз в минуту; это
цена, которую платят за то, что чужое задание нельзя увидеть даже по ошибке.

ОПОЗДАНИЕ — ИСХОД, А НЕ ОШИБКА. Служба могла стоять, машина — перезагружаться.
Публикация всё равно случится, и об этом скажут вслух: `delay_seconds` и
отдельное событие. Тихо сделать вид, что всё по плану, нельзя — оператор
обещал гостям завтрак с новым оформлением.
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta
from typing import Callable

from django.db import transaction
from django.utils import timezone

from apps.core.context import current_actor, tenant_context
from apps.core.errors import ValidationError
from apps.core.models import AuditLog, ScheduledJob, SchedulerHeartbeat

# Вид задания → обработчик. Регистрируется приложением-владельцем работы при
# загрузке (см. `apps/hotels/apps.py`): планировщик не импортирует прикладной
# код, иначе он знал бы о бренде, переводах и уведомлениях сразу обо всех.
_HANDLERS: dict[str, Callable[[ScheduledJob], dict]] = {}


# Задание, чей срок прошёл больше двух минут назад, а оно всё ждёт, —
# просрочено: круг ходит раз в минуту, и два круга подряд его не взяли.
OVERDUE_AFTER_MINUTES = 2


def register(kind: str, handler: Callable[[ScheduledJob], dict]) -> None:
    _HANDLERS[kind] = handler


def known_kinds() -> list[str]:
    return sorted(_HANDLERS)


# --- Назначение и отмена ---------------------------------------------------


def schedule(*, kind: str, run_at: datetime, payload: dict | None = None) -> ScheduledJob:
    """
    Назначить работу на момент. `run_at` — уже в UTC, перевод из времени отеля
    делает вызывающий: только он знает, чьё местное время назвали.
    """
    if kind not in _HANDLERS:
        raise ValidationError(
            f"Неизвестный вид задания «{kind}»", field="kind", code="unknown_job_kind"
        )
    if timezone.is_naive(run_at):
        raise ValidationError(
            "Момент запуска должен быть с часовым поясом",
            field="run_at",
            code="naive_datetime",
        )

    actor = current_actor()
    user = actor if getattr(actor, "pk", None) else None
    return ScheduledJob.objects.create(
        kind=kind,
        payload=payload or {},
        run_at=run_at,
        created_by=user,
        created_by_name=_actor_name(user),
    )


def cancel(job_id) -> ScheduledJob:
    """
    Отменить до срабатывания.

    Отменить УЖЕ ВЫПОЛНЕННОЕ нельзя, и это не формальность: витрина уже
    изменилась, и «отмена» задним числом создала бы у оператора ложное
    ощущение, что он всё вернул.
    """
    job = ScheduledJob.objects.filter(pk=job_id).first()
    if job is None:
        raise ValidationError("Задание не найдено", field="job", code="job_not_found")
    if job.status != ScheduledJob.Status.PENDING:
        raise ValidationError(
            "Задание уже отработало — отменять нечего",
            field="job",
            code="job_not_pending",
        )
    job.status = ScheduledJob.Status.CANCELLED
    job.save(update_fields=["status", "updated_at"])
    AuditLog.record(
        "scheduler.cancelled",
        object_type="scheduled_job",
        object_id=job.pk,
        payload={"kind": job.kind, "run_at": job.run_at.isoformat()},
    )
    return job


def pending_jobs(kind: str = "") -> list[ScheduledJob]:
    query = ScheduledJob.objects.filter(status=ScheduledJob.Status.PENDING)
    if kind:
        query = query.filter(kind=kind)
    return list(query.order_by("run_at"))


# --- Круг проверки ---------------------------------------------------------


def run_due_for_hotel(now: datetime) -> int:
    """
    Выполнить всё, чему пришёл срок, В ТЕКУЩЕМ отеле. Возвращает число заданий.

    Блокировка строки — не перестраховка: служб может оказаться две (выкатили
    новую, старая ещё жива), и обе увидят одно задание. `skip_locked` означает,
    что вторая просто пройдёт мимо, а не сделает публикацию дважды.
    """
    done = 0
    while True:
        with transaction.atomic():
            job = (
                ScheduledJob.objects.select_for_update(skip_locked=True)
                .filter(status=ScheduledJob.Status.PENDING, run_at__lte=now)
                .order_by("run_at")
                .first()
            )
            if job is None:
                return done
            _execute(job, now=now)
            done += 1


def _execute(job: ScheduledJob, *, now: datetime) -> None:
    job.attempts += 1
    job.executed_at = now
    job.delay_seconds = max(0, int((now - job.run_at).total_seconds()))

    handler = _HANDLERS.get(job.kind)
    if handler is None:
        # Вид задания исчез вместе с кодом — это не повод молчать: строка
        # остаётся в журнале с причиной, а не притворяется выполненной.
        job.status = ScheduledJob.Status.FAILED
        job.result = {"reason": "unknown_kind"}
        job.save(update_fields=["status", "result", "attempts", "executed_at", "delay_seconds", "updated_at"])
        return

    try:
        outcome = handler(job) or {}
    except Exception as exc:  # noqa: BLE001 — сбой одного задания не валит круг
        job.status = ScheduledJob.Status.FAILED
        job.result = {"reason": "error", "detail": str(exc)[:500]}
    else:
        # Обработчик сам решает, состоялась ли работа: «не состоялась» — это
        # исход, а не ошибка, и отличать их обязан тот, кто знает предметную
        # область.
        job.status = (
            ScheduledJob.Status.SKIPPED
            if outcome.get("skipped")
            else ScheduledJob.Status.DONE
        )
        job.result = outcome
    job.save(
        update_fields=["status", "result", "attempts", "executed_at", "delay_seconds", "updated_at"]
    )


def tick(now: datetime | None = None) -> dict:
    """
    Один круг по всему флоту. Возвращает сводку — её же показывает консоль.

    Пульс пишется ВСЕГДА, даже когда делать было нечего: «служба просыпалась и
    работы не было» и «служба не просыпалась» — разные вещи, и различить их
    можно только по отметке времени.
    """
    from apps.hotels.models import Hotel

    from django.db.models import Count, Q

    started = time.monotonic()
    now = now or timezone.now()
    done = 0
    error = ""
    # Разбивка по видам: со вторым потребителем (ступени эскалации) одна общая
    # цифра перестала говорить, чьё опаздывает.
    by_kind: dict[str, dict[str, int]] = {}
    late_after = now - timedelta(minutes=OVERDUE_AFTER_MINUTES)

    for hotel in Hotel.objects.all().only("id"):
        try:
            with tenant_context(hotel.id):
                rows = (
                    ScheduledJob.objects.filter(status=ScheduledJob.Status.PENDING)
                    .values("kind")
                    .annotate(
                        # Ждут срока — ещё впереди. Пришедшие сроком круг
                        # выполнит сейчас же, и «ждут» они только до его конца.
                        pending=Count("id", filter=Q(run_at__gt=now)),
                        due=Count("id", filter=Q(run_at__lte=now)),
                        overdue=Count("id", filter=Q(run_at__lt=late_after)),
                    )
                )
                for row in rows:
                    bucket = by_kind.setdefault(row["kind"], {"pending": 0, "due": 0, "overdue": 0})
                    for field in ("pending", "due", "overdue"):
                        bucket[field] += row[field]
                done += run_due_for_hotel(now)
        except Exception as exc:  # noqa: BLE001 — один отель не должен ронять круг
            error = f"{hotel.id}: {exc}"[:500]

    due = sum(bucket["due"] for bucket in by_kind.values())
    overdue = sum(bucket["overdue"] for bucket in by_kind.values())
    pending = sum(bucket["pending"] for bucket in by_kind.values())

    heartbeat = SchedulerHeartbeat.objects.first() or SchedulerHeartbeat(id=1)
    heartbeat.last_tick_at = timezone.now()
    heartbeat.took_ms = int((time.monotonic() - started) * 1000)
    heartbeat.due_count = due
    heartbeat.overdue_count = overdue
    # «Ждут» — то, что осталось после круга: срок впереди плюс пришедшее
    # сроком, но не взятое (его держит другая служба). Выполненное в этом
    # круге ждать перестало.
    heartbeat.pending_count = pending + max(0, due - done)
    heartbeat.by_kind = by_kind
    heartbeat.done_last_tick = done
    heartbeat.last_error = error
    heartbeat.save()

    return {
        "due": due,
        "overdue": overdue,
        "pending": heartbeat.pending_count,
        "done": done,
        "error": error,
        "by_kind": by_kind,
    }


def heartbeat_state() -> dict:
    """
    Состояние службы для консоли платформы.

    `age_seconds` считается здесь, а не на экране: «когда просыпалась» без
    «сколько прошло» читается как исправность даже тогда, когда служба стоит со
    вчера.
    """
    heartbeat = SchedulerHeartbeat.objects.first()
    if heartbeat is None or heartbeat.last_tick_at is None:
        return {
            "last_tick_at": None,
            "age_seconds": None,
            "alive": False,
            "due": 0,
            "overdue": 0,
            "pending": 0,
            "by_kind": {},
            "took_ms": 0,
            "last_error": "",
        }
    age = int((timezone.now() - heartbeat.last_tick_at).total_seconds())
    return {
        "last_tick_at": heartbeat.last_tick_at.isoformat(),
        "age_seconds": age,
        # Живой — это «просыпалась не позже трёх минут назад». Круг ходит раз в
        # минуту; три даёт запас на долгий круг и не прощает остановки.
        "alive": age <= 180,
        "due": heartbeat.due_count,
        "overdue": heartbeat.overdue_count,
        "pending": heartbeat.pending_count,
        "by_kind": heartbeat.by_kind or {},
        "took_ms": heartbeat.took_ms,
        "last_error": heartbeat.last_error,
    }


def _actor_name(user) -> str:
    if user is None:
        return ""
    full = " ".join(filter(None, [getattr(user, "first_name", ""), getattr(user, "last_name", "")]))
    return (full or getattr(user, "email", "") or "").strip()[:180]
