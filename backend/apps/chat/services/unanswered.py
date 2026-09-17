"""
Молчащий чат: гость написал, ответа нет дольше порога отеля.

МЕХАНИЗМ — СУЩЕСТВУЮЩИЙ. Срок держит служба расписания (как ступени
эскалации заказов), сигнал идёт справочником событий волны 6: сначала смене
ресепшена (`chat.unanswered`), потом, если и она молчит, — руководителю
(`chat.unanswered_long`). Второй механизм не заводим.

ПОЧЕМУ БЕЗ ОТМЕНЫ. Ответил ресепшен — задание просто ничего не делает: оно
спрашивает тред заново. Отменять задание на каждый ответ значило бы держать
ещё один путь, который может не сработать, — а тишина здесь дороже лишнего
пустого круга.
"""

from __future__ import annotations

from datetime import timedelta

from django.utils import timezone

JOB_KIND = "chat.unanswered"


def schedule_check(thread, *, step: int = 1) -> None:
    """Назначить проверку: через порог (шаг 1) или через два (шаг 2)."""
    from apps.core.services import scheduler

    from apps.chat.services.threads import reply_wait_minutes

    guest_at = thread.last_guest_message_at
    if guest_at is None:
        return
    minutes = reply_wait_minutes() * step
    scheduler.schedule(
        kind=JOB_KIND,
        run_at=guest_at + timedelta(minutes=minutes),
        payload={"thread_id": str(thread.pk), "step": step, "waiting_since": guest_at.isoformat()},
    )


def run(job) -> dict:
    """
    Обработчик задания: если гость всё ещё ждёт ТОГО ЖЕ сообщения — сигнал.

    Сверяемся по моменту сообщения гостя: за время ожидания он мог написать
    снова (тогда свой срок считает новое задание) или получить ответ.
    """
    from django.utils.dateparse import parse_datetime

    from apps.chat.models import ChatThread
    from apps.notifications.services import event_values
    from apps.notifications.services.events import notify

    payload = job.payload or {}
    step = int(payload.get("step") or 1)
    thread = ChatThread.objects.filter(pk=payload.get("thread_id")).select_related("room").first()
    if thread is None:
        return {"outcome": "gone"}
    waiting_since = parse_datetime(payload.get("waiting_since") or "")
    if thread.last_guest_message_at is None or (
        waiting_since is not None and thread.last_guest_message_at != waiting_since
    ):
        return {"outcome": "superseded"}
    if thread.last_staff_message_at is not None and thread.last_staff_message_at >= thread.last_guest_message_at:
        return {"outcome": "answered"}

    minutes = int((timezone.now() - thread.last_guest_message_at).total_seconds() // 60)
    last = thread.messages.filter(author_type="guest").order_by("-created_at").first()
    code = "chat.unanswered" if step == 1 else "chat.unanswered_long"
    notify(
        code,
        event_values.chat_unanswered(
            {
                "room": thread.room.number if thread.room_id else "",
                "preview": (last.body if last else "")[:120],
                "minutes": minutes,
            }
        ),
        point_id=thread.execution_point_id,
        dedupe_key=f"{code}:{thread.pk}:{thread.last_guest_message_at.isoformat()}",
    )
    if step == 1:
        # Смена предупреждена; если и она промолчит — поднимем руководителю.
        schedule_check(thread, step=2)
    return {"outcome": "notified", "minutes": minutes, "step": step}
