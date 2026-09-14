"""
ПУБЛИКАЦИЯ ОФОРМЛЕНИЯ ПО РАСПИСАНИЮ.

Оператор готовит новогоднюю витрину заранее и хочет, чтобы она встала в полночь
по времени ОТЕЛЯ, а не по времени сервера и не по времени его собственного
ноутбука. Здесь — перевод названного им времени в момент, обработчик, который
сработает ночью, и три события, по которым утром видно, что произошло.

════ ЧТО ДЕЛАТЬ С УСТАРЕВШИМ ЧЕРНОВИКОМ НОЧЬЮ ════

Сторож из г1 отказывается публиковать черновик, начатый от версии, которую уже
сменили: он не «немного отстал», он не знает о чужой работе вообще и сотрёт её
целиком. Днём оператор отвечает на вопрос сам. Ночью спросить некого.

РЕШЕНИЕ: НЕ ПУБЛИКОВАТЬ, пометить «не состоялась», уведомить, ЧЕРНОВИК СОХРАНИТЬ.

Довод. Человек утвердил публикацию, зная основу X. За ночь основа сменилась —
значит, утверждённое им решение больше не относится к тому, что лежит на витрине
сейчас. Опубликовать — стереть чужую работу молча и без свидетелей: утром
никто даже не вспомнит, что было две правки. Это ровно тот класс дефектов, из-за
которого сторож и заведён; ночь не делает его безопаснее, она делает его тише.

Обратную сторону называю честно: отель, ждавший новогоднее оформление к
завтраку, его не получит. Это плохо — но поправимо за минуту утром, а стёртая
чужая работа не поправима вовсе. Поэтому черновик не удаляется: он остаётся
ровно таким, каким его готовили, и оператор решает сам — опубликовать поверх
или перенести правки.

Что рассматривалось и отклонено:
  • опубликовать всё равно — молча стирает чужое, см. выше;
  • слить автоматически — «слияние оформлений» не определено: два человека
    выбрали разные цвета на одном поле, и машине нечем решить, чей взять;
  • перенести на час позже — ждать человека, которого ночью нет, и потерять
    ровно тот момент, ради которого расписание и заводили.
"""

from __future__ import annotations

from datetime import datetime, timezone as dt_timezone

from django.utils import timezone

from apps.accounts.services.roles import require_hotel_admin
from apps.core.errors import ValidationError
from apps.core.models import AuditLog, ScheduledJob
from apps.core.services import scheduler
from apps.hotels.models import BrandVersion

KIND = "brand.publish"

# Событие «опубликовано позже назначенного» поднимается, когда опоздание больше
# этого. Минута — не про точность, а про смысл: круг ходит раз в минуту, и
# опоздание внутри круга опозданием не является.
LATE_AFTER_SECONDS = 60


def schedule_publication(draft_id, *, local_run_at: datetime | str, hotel) -> ScheduledJob:
    """
    Назначить публикацию черновика на местное время отеля.

    ВРЕМЯ НАЗЫВАЮТ МЕСТНОЕ — и это единственная форма, в которой оно имеет
    смысл: «в полночь» для отеля в Сочи и для отеля в Дубае — разные моменты, а
    оператор знает только свой. Перевод делается ЗДЕСЬ и один раз.
    """
    require_hotel_admin()

    draft = BrandVersion.objects.filter(pk=draft_id, kind=BrandVersion.Kind.DRAFT).first()
    if draft is None:
        raise ValidationError("Черновик не найден", field="draft", code="draft_not_found")

    moment = _parse_local(local_run_at)
    if timezone.is_naive(moment):
        moment = timezone.make_aware(moment, hotel.tzinfo)
    moment = moment.astimezone(dt_timezone.utc)

    if moment <= timezone.now():
        raise ValidationError(
            "Это время уже прошло по часам отеля",
            field="run_at",
            code="run_at_in_past",
        )

    # Одному черновику — одна назначенная публикация. Две означали бы, что
    # витрина сменится дважды непонятно в каком порядке.
    for job in scheduler.pending_jobs(KIND):
        if str(job.payload.get("draft_id")) == str(draft.pk):
            scheduler.cancel(job.pk)

    job = scheduler.schedule(
        kind=KIND,
        run_at=moment,
        payload={"draft_id": str(draft.pk), "draft_name": draft.name},
    )
    AuditLog.record(
        "brand.publication_scheduled",
        object_type="brand_draft",
        object_id=draft.pk,
        payload={"run_at": moment.isoformat(), "draft_name": draft.name},
    )
    return job


def run(job: ScheduledJob) -> dict:
    """
    Обработчик: выполнить назначенную публикацию.

    Возвращает исход, а не бросает исключение на «не состоялась»: несостоявшаяся
    публикация — нормальный ответ системы, и путать её со сбоем нельзя ни в
    журнале, ни в уведомлении.
    """
    from apps.hotels.services import brand_versions

    draft = BrandVersion.objects.filter(
        pk=job.payload.get("draft_id"), kind=BrandVersion.Kind.DRAFT
    ).first()

    if draft is None:
        _announce(
            "brand.schedule_failed",
            reason="draft_gone",
            payload={"draft_name": job.payload.get("draft_name", "")},
        )
        return {"skipped": True, "reason": "draft_gone"}

    if draft.is_stale:
        # Спросить некого — см. доводы в шапке файла. Черновик остаётся жить.
        current = brand_versions.current_published()
        _announce(
            "brand.schedule_failed",
            reason="draft_stale",
            payload={
                "draft_name": draft.name,
                "base_version": draft.base_version.number if draft.base_version else None,
                "current_version": current.number if current else None,
            },
        )
        return {
            "skipped": True,
            "reason": "draft_stale",
            "base_version": draft.base_version.number if draft.base_version else None,
            "current_version": current.number if current else None,
        }

    version = brand_versions.publish_tokens(draft.tokens, name=draft.name)
    draft.delete()

    late = job.delay_seconds > LATE_AFTER_SECONDS
    _announce(
        "brand.published_late" if late else "brand.published_on_schedule",
        reason="late" if late else "on_time",
        payload={
            "version": version.number,
            "draft_name": version.name,
            "delay_seconds": job.delay_seconds,
        },
    )
    return {"version": version.number, "late": late, "delay_seconds": job.delay_seconds}


def _announce(event: str, *, reason: str, payload: dict) -> None:
    """
    Событие — В ЖУРНАЛ ВСЕГДА, в каналы — если отель их завёл.

    Журнал первичен: он переживёт и упавший телеграм, и отсутствующий канал, и
    именно по нему утром восстанавливают, что ночью произошло. Рассылка —
    удобство поверх, и её отказ не делает событие несостоявшимся.
    """
    AuditLog.record(
        event,
        actor_type=AuditLog.ActorType.SYSTEM,
        object_type="brand_version",
        object_id=payload.get("version"),
        payload={**payload, "reason": reason},
    )
    try:
        from apps.notifications.services.announce import announce_to_hotel

        announce_to_hotel(event, payload)
    except Exception:  # noqa: BLE001 — рассылка не вправе отменить публикацию
        AuditLog.record(
            "brand.announce_failed",
            actor_type=AuditLog.ActorType.SYSTEM,
            payload={"event": event},
        )


def serialize_job(job: ScheduledJob) -> dict:
    """
    Назначенная публикация на выдачу — в ОБОИХ временах.

    `run_at` в UTC нужен машине, `run_at_local` — человеку: оператор назначал по
    часам отеля и проверять будет по ним же. Отдавать только UTC значило бы
    заставлять его считать в уме и ошибаться на час дважды в год.
    """
    from apps.hotels.services.hotel import current_hotel

    hotel = current_hotel()
    local = job.run_at.astimezone(hotel.tzinfo) if hotel else job.run_at
    return {
        "id": str(job.pk),
        "draft_id": job.payload.get("draft_id"),
        "draft_name": job.payload.get("draft_name", ""),
        "run_at": job.run_at.isoformat(),
        "run_at_local": local.isoformat(),
        "timezone": str(hotel.tzinfo) if hotel else "UTC",
        "status": job.status,
        "created_by": job.created_by_name,
        "delay_seconds": job.delay_seconds,
        "result": job.result,
    }


def _parse_local(value: datetime | str) -> datetime:
    """
    Местное время отеля из строки вида `2026-12-31T23:59`.

    Часовой пояс в строке НЕ принимается: его прислал бы браузер оператора, а
    оператор может быть в отпуске в другом поясе — и «полночь» стала бы чужой.
    Пояс у этого времени ровно один, отельный, и подставляет его сервер.
    """
    if isinstance(value, datetime):
        return value
    text = str(value).strip().replace("Z", "").split("+")[0]
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as exc:
        raise ValidationError(
            f"Не разобрать время: {value}", field="run_at", code="run_at_invalid"
        ) from exc
    return parsed.replace(tzinfo=None)
