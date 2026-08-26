"""
ПУБЛИКАЦИЯ КАК МАШИНА: применить одно ко многим и честно отчитаться.

Устройство:

* ПУБЛИКАТОР знает про одну сущность — как её применить одному отелю и как
  описать словами. Реестр публикаторов закрыт: вид, которого в нём нет, не
  запускается вовсе, а не пишет неизвестно что.
* ЦЕЛЬ считается ОДНИМ кодом и для предпросмотра, и для применения. Разные
  места давали бы «применится к 47» и применение к сорока восьми.
* ИСПОЛНЕНИЕ идёт по отелям, каждый в СВОЁМ тенант-контексте. RLS не
  обходится: платформенная роль на массовой записи означает, что одна ошибка в
  фильтре пишет всем.
* ОТЧЁТ — строка на отель. Отказ одного не роняет остальных: исключение
  ловится вокруг каждого отеля, записывается причиной и работа идёт дальше.
  Иначе двухсотый отель отменял бы работу первых ста девяноста девяти.

ИДЕМПОТЕНТНОСТЬ. Публикатор ищет свою запись по КЛЮЧУ ИСТОЧНИКА, а не по
названию: у бейджа это `preset` — код библиотеки платформы. Пустой `preset`
означает собственную запись отеля, и она не наша: совпадение названий не даёт
права её переписать.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from django.utils import timezone

from apps.core.context import tenant_context
from apps.core.errors import PermissionDenied, ValidationError
from apps.hotels.models import Hotel, PublicationJob, PublicationResult

logger = logging.getLogger(__name__)

Outcome = PublicationResult.Outcome


@dataclass(slots=True)
class Applied:
    outcome: str
    detail: str = ""
    #: Машиночитаемая причина: `same`, `local_edit`, `unknown_origin`.
    reason: str = ""


# --- Публикаторы ------------------------------------------------------------


class BadgePublisher:
    """
    Маркетинговый бейдж из библиотеки платформы.

    Ключ идемпотентности — `preset`: поле существует в модели ровно для этого
    («код пресета, если бейдж заведён из библиотеки»). Повторная публикация
    находит свою строку и обновляет её, а не заводит вторую.

    ЛОКАЛЬНАЯ ПРАВКА ОТЕЛЯ НЕ ПЕРЕТИРАЕТСЯ — и это то же правило, что у
    эталона справочника (`inheritance.py`), а не новое. Отель, переименовавший
    наш бейдж, получает `skipped` с причиной: публикация не спорит с человеком,
    а сообщает платформе, что здесь разошлись. Вернуть к нашему виду можно тем
    же способом, что и в справочнике, — явным действием, а не молча.
    """

    kind = "badge"
    #: Что сравниваем, решая «то же самое или отель правил».
    fields = ("label", "color_role", "sort_order")

    def describe(self, payload: dict) -> str:
        label = payload.get("label") or {}
        return f"бейдж «{label.get('ru') or payload.get('preset')}»"

    def validate(self, payload: dict) -> None:
        if not (payload.get("preset") or "").strip():
            raise ValidationError("Нужен код пресета", field="preset", code="preset_required")
        if not payload.get("label"):
            raise ValidationError("Нужно название", field="label", code="label_required")

    def apply(self, hotel: Hotel, payload: dict, *, previous: dict | None = None) -> Applied:
        from apps.catalog.models import Badge
        from apps.hotels.services.platform import inheritance

        preset = payload["preset"].strip()
        wanted = {
            "label": payload["label"],
            "color_role": payload.get("color_role") or Badge.ColorRole.ACCENT,
            "sort_order": payload.get("sort_order") or 0,
        }

        row = Badge.objects.filter(preset=preset).first()
        if row is None:
            Badge.objects.create(preset=preset, is_active=True, **wanted)
            return Applied(Outcome.APPLIED, "заведён")

        current = {field: getattr(row, field) for field in self.fields}
        if current == wanted:
            # Повтор: у отеля уже ровно то же. Не работа, и считать её работой
            # значило бы отчитываться «применено 200» на пустом месте.
            return Applied(Outcome.SKIPPED, "уже совпадает", reason="same")

        # ТРОНУЛ ЛИ ОТЕЛЬ ЭТУ ЗАПИСЬ — то же правило, что у эталона справочника
        # (`inheritance.is_untouched`), а не новое: копия, совпадающая с тем,
        # что мы публиковали В ПРОШЛЫЙ РАЗ, не тронута по определению.
        if previous is None:
            # Прошлой публикации нет: строка появилась не от нас (сид, миграция,
            # руки администратора). Доказать, что значение наше, нечем —
            # значит не трогаем. Осторожность здесь дешевле: переписанный
            # чужой бейдж заметят на витрине, а не в отчёте.
            return Applied(
                Outcome.SKIPPED,
                "запись есть, но прежней публикации нет — не знаем, наше ли это значение",
                reason="unknown_origin",
            )

        if not inheritance.is_untouched(current, previous):
            return Applied(
                Outcome.SKIPPED,
                "у отеля своя правка этого бейджа — публикация её не трогает",
                reason="local_edit",
            )

        for field, value in wanted.items():
            setattr(row, field, value)
        row.save(update_fields=[*wanted.keys(), "updated_at"])
        return Applied(Outcome.APPLIED, "обновлён")

    def previous_payload(self, payload: dict) -> dict | None:
        """
        Что мы публиковали этим пресетом в прошлый раз.

        История публикаций и есть наш «прежний эталон»: отдельного поля под
        него заводить не пришлось. Берём последнюю ЗАВЕРШЁННУЮ публикацию того
        же пресета, кроме текущей.
        """
        preset = payload["preset"].strip()
        job = (
            PublicationJob.objects.filter(
                kind=self.kind,
                status=PublicationJob.Status.DONE,
                payload__preset=preset,
            )
            .order_by("-created_at")
            .first()
        )
        if job is None:
            return None
        return {
            "label": job.payload.get("label"),
            "color_role": job.payload.get("color_role") or "accent",
            "sort_order": job.payload.get("sort_order") or 0,
        }


PUBLISHERS = {publisher.kind: publisher for publisher in (BadgePublisher(),)}


def publisher_for(kind: str):
    publisher = PUBLISHERS.get((kind or "").strip())
    if publisher is None:
        raise ValidationError(
            f"Неизвестный вид публикации «{kind}»", field="kind", code="unknown_kind"
        )
    return publisher


# --- Цель -------------------------------------------------------------------


def targets(*, scope: str, group_id=None, hotel_ids=None, user=None):
    """
    Отели цели. ОДИН код на предпросмотр и на применение.

    У группы-правила состав вычисляется здесь же и сейчас — тем же сервисом,
    что режет флот. Предпросмотр, показавший 47, и применение к 48 означали бы,
    что между ними отель завели: это видно по `planned` в отчёте, а не по
    расхождению двух разных подсчётов.
    """
    from apps.hotels.services.platform import groups as groups_svc
    from apps.hotels.services.platform import scope as scope_svc

    if scope == PublicationJob.Scope.ALL:
        queryset = Hotel.objects.filter(is_active=True)
    elif scope == PublicationJob.Scope.GROUP:
        group = groups_svc.get(str(group_id), user)
        queryset = Hotel.objects.filter(pk__in=groups_svc.hotel_ids(group))
    else:
        queryset = Hotel.objects.filter(pk__in=list(hotel_ids or []))

    # ЦЕЛЬ ВСЕГДА ВНУТРИ ОБЛАСТИ. Группа может быть шире области человека —
    # тогда применяется пересечение. Резать здесь, а не в момент применения,
    # обязательно: предпросмотр обязан показать то же число, что и отчёт.
    return scope_svc.limit_queryset(user, queryset)


def check_rights(user, scope: str) -> None:
    """
    ПРАВО ПО ВЕСУ ДЕЙСТВИЯ.

    «Изменить один отель» и «изменить двести» — не одно и то же, а декоратор
    ручки статичен и веса не различает. Публикация на весь флот требует
    владельца; на группу и на перечень достаточно поддержки — того же права,
    которым эти отели правятся по одному.
    """
    from apps.accounts.services.platform_access import can_write, is_owner

    if scope == PublicationJob.Scope.ALL:
        if not is_owner(user):
            raise PermissionDenied(
                "Публикация на весь флот доступна только владельцу платформы",
                code="owner_required",
            )
        return
    if not can_write(user):
        raise PermissionDenied("Роль «только чтение» ничего не публикует", code="forbidden")


def preview(*, kind: str, payload: dict, scope: str, group_id=None, hotel_ids=None, user=None) -> dict:
    """Что и к скольким применится — ДО нажатия."""
    from apps.hotels.services.platform import scope as scope_svc

    publisher = publisher_for(kind)
    publisher.validate(payload)
    queryset = targets(scope=scope, group_id=group_id, hotel_ids=hotel_ids, user=user)

    # Сколько цели осталось ЗА областью — числом и до нажатия. Узнать это по
    # отчёту, в котором половины отелей просто нет, значит не узнать вовсе.
    wide = targets(scope=scope, group_id=group_id, hotel_ids=hotel_ids)
    outside = max(wide.count() - queryset.count(), 0) if scope_svc.is_limited(user) else 0

    return {
        "kind": kind,
        "description": publisher.describe(payload),
        "count": queryset.count(),
        "outside_scope": outside,
        # Несколько имён для проверки глазами: число без единого названия
        # одинаково выглядит и для правильной цели, и для ошибочной.
        "sample": [hotel.subdomain for hotel in queryset.order_by("subdomain")[:5]],
    }


# --- Запуск и исполнение ----------------------------------------------------


def start(*, kind: str, payload: dict, scope: str, group_id=None, hotel_ids=None, actor_id=None, user=None):
    """
    Завести публикацию и отдать её воркеру.

    Синхронно здесь НЕ делается ничего, кроме проверки и записи: двести отелей
    в одном запросе — это гарантированный таймаут и отчёт, который некому
    дочитать.
    """
    from apps.hotels.tasks import run_publication

    publisher_for(kind).validate(payload)
    planned = targets(scope=scope, group_id=group_id, hotel_ids=hotel_ids, user=user).count()
    if not planned:
        raise ValidationError(
            "В цели публикации нет ни одного отеля", field="scope", code="empty_target"
        )

    job = PublicationJob.objects.create(
        kind=kind,
        payload=payload,
        scope=scope,
        group_id=group_id or None,
        hotel_ids=[str(hid) for hid in (hotel_ids or [])],
        actor_id=actor_id,
        planned=planned,
    )
    # Отправляем ПОСЛЕ создания строки: задача, стартовавшая раньше записи,
    # не нашла бы работу и завершилась «успехом» в пустоту.
    run_publication.delay(str(job.pk))
    return job


def run(job_id: str) -> dict[str, int]:
    """
    Тело фоновой операции. Возобновляемо: отели с уже записанным результатом
    пропускаются.

    ПЕРЕЗАПУСК ВОРКЕРА. `CELERY_TASK_ACKS_LATE` включён, поэтому убитая задача
    вернётся в очередь и приедет снова — и увидит здесь, что часть отелей уже
    сделана. Состояние живёт в базе, а не в памяти исполнителя: только так
    «сто из двухсот» переживает kill -9.
    """
    job = PublicationJob.objects.filter(pk=job_id).first()
    if job is None:
        logger.warning("публикация %s не найдена — задача пришла раньше записи?", job_id)
        return {}

    try:
        publisher = publisher_for(job.kind)
    except ValidationError as exc:
        job.status = PublicationJob.Status.FAILED
        job.error = str(exc)
        job.finished_at = timezone.now()
        job.save(update_fields=["status", "error", "finished_at", "updated_at"])
        return {}

    if job.status != PublicationJob.Status.RUNNING:
        job.status = PublicationJob.Status.RUNNING
        job.started_at = job.started_at or timezone.now()
        job.save(update_fields=["status", "started_at", "updated_at"])

    done = set(
        PublicationResult.objects.filter(job=job).values_list("hotel_id", flat=True)
    )
    # Прежнее опубликованное значение — ОДНО на всю публикацию: оно про то, что
    # мы разослали в прошлый раз, а не про конкретный отель.
    previous = (
        publisher.previous_payload(job.payload)
        if hasattr(publisher, "previous_payload")
        else None
    )
    counts: dict[str, int] = {}

    # ЦЕЛЬ ПЕРЕСЧИТЫВАЕТСЯ И ЗДЕСЬ, вместе с областью запустившего.
    #
    # Правило группы обязано считаться в момент применения — это его смысл. А
    # область берётся у ТОГО ЖЕ человека и на ТОТ ЖЕ момент: если его область
    # сузили, пока задача ждала в очереди, публиковать по прежней было бы
    # применением права, которого у него уже нет.
    actor = _actor(job.actor_id)
    for hotel in targets(
        scope=job.scope, group_id=job.group_id, hotel_ids=job.hotel_ids, user=actor
    ):
        if hotel.pk in done:
            continue
        outcome, detail, reason = _apply_one(publisher, hotel, job.payload, previous)
        PublicationResult.objects.create(
            job=job, hotel=hotel, outcome=outcome, detail=detail, reason=reason
        )
        counts[outcome] = counts.get(outcome, 0) + 1

    job.status = PublicationJob.Status.DONE
    job.finished_at = timezone.now()
    job.save(update_fields=["status", "finished_at", "updated_at"])
    return counts


def _apply_one(publisher, hotel: Hotel, payload: dict, previous: dict | None) -> tuple[str, str, str]:
    """
    Один отель — в своём контексте и под своей защитой.

    Исключение ловится ЗДЕСЬ, вокруг одного отеля: иначе отказ на сто первом
    отменял бы работу первых ста, и повторный запуск начинал бы всё заново.
    """
    try:
        with tenant_context(hotel):
            result = publisher.apply(hotel, payload, previous=previous)
        return result.outcome, result.detail, result.reason
    except Exception as exc:  # noqa: BLE001 — причина уезжает в отчёт целиком
        logger.exception("публикация в отель %s не удалась", hotel.subdomain)
        return Outcome.FAILED, f"{type(exc).__name__}: {exc}", "exception"


# --- Выдача -----------------------------------------------------------------


def _actor(actor_id):
    """Учётка запустившего — нужна исполнителю, чтобы знать его область."""
    from apps.accounts.models import User
    from apps.core.context import platform_scope

    if not actor_id:
        return None
    with platform_scope():
        return User.all_objects.using("platform").filter(pk=actor_id).first()


def _actor_name(actor_id) -> str:
    """Кто запустил. UUID человеку не говорит ничего."""
    from apps.accounts.models import User
    from apps.core.context import platform_scope

    if not actor_id:
        return ""
    with platform_scope():
        user = User.all_objects.using("platform").filter(pk=actor_id).first()
    return (user.full_name or user.email) if user else ""


def get(job_id: str) -> PublicationJob:
    """Публикация по id. Выборка живёт в сервисе — вьюха её зовёт."""
    from apps.core.errors import NotFoundError

    job = PublicationJob.objects.filter(pk=job_id).first()
    if job is None:
        raise NotFoundError("Публикация не найдена")
    return job


def history(*, limit: int = 50) -> list[dict]:
    """Последние публикации с числами. Без строк по отелям — они в отчёте."""
    size = max(1, min(limit, 200))
    return [serialize(job) for job in PublicationJob.objects.all()[:size]]


def serialize(job: PublicationJob, *, with_results: bool = False) -> dict:
    results = PublicationResult.objects.filter(job=job).select_related("hotel")
    counts: dict[str, int] = {}
    for row in results:
        counts[row.outcome] = counts.get(row.outcome, 0) + 1

    publisher = PUBLISHERS.get(job.kind)
    data = {
        "id": str(job.pk),
        "kind": job.kind,
        # Что публиковали — словами. Код вида и payload человеку не говорят
        # ничего через неделю после запуска.
        "description": publisher.describe(job.payload) if publisher else job.kind,
        "group": job.group.title if job.group_id and job.group else "",
        "actor": _actor_name(job.actor_id),
        "scope": job.scope,
        "status": job.status,
        "planned": job.planned,
        "error": job.error,
        "created_at": job.created_at.isoformat(),
        "finished_at": job.finished_at.isoformat() if job.finished_at else None,
        "counts": counts,
        # Сколько ещё не тронуто. Разница «запланировано минус отчитано» —
        # единственный честный ответ на «сколько осталось» у операции, которая
        # может быть прервана.
        "pending": max(job.planned - sum(counts.values()), 0),
    }
    if with_results:
        data["results"] = [
            {
                "hotel_id": str(row.hotel_id),
                "subdomain": row.hotel.subdomain,
                "name": row.hotel.name_i18n,
                "outcome": row.outcome,
                "detail": row.detail,
                "reason": row.reason,
            }
            for row in results
        ]
    return data
