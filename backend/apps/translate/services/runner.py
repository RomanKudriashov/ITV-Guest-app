"""
Массовый прогон перевода: очередь, отчёт, учёт расхода.

ПОРЯДОК РЕШЕНИЙ ПО КАЖДОМУ ЗНАЧЕНИЮ — он же порядок проверок:
  1. исходника нет → переводить нечего;
  2. значение уже есть и его писал ЧЕЛОВЕК → не трогаем никогда;
  3. значение писала машина, а исходник с тех пор не менялся → нечего делать;
  4. строка — только имя собственное → переносим как есть, модель не зовём;
  5. иначе зовём модель. Не подключена → пропуск с причиной, поле ОСТАЁТСЯ
     ПУСТЫМ. Ошибка модели → строка в отчёт, прогон продолжается.

Расход считается на каждый удачный вызов: символы и вызовы по месяцам отеля.
"""

from __future__ import annotations

import hashlib

from django.db import transaction
from django.utils import timezone

from apps.core.fields import as_translations

from apps.translate.fields import specs_for
from apps.translate.models import TranslationMark, TranslationRun, TranslationUsage
from apps.translate.proper_nouns import is_only_proper_noun, keep_words, protected
from apps.translate.providers import TranslationRequest, TranslationUnavailable, get_provider


def _hash(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()[:32]


def queue_run(*, languages, groups=None, user=None) -> TranslationRun:
    """
    Поставить прогон в очередь. Работа идёт задачей: каталог отеля — это
    тысячи значений, и держать оператора на открытой вкладке незачем.
    """
    from apps.core.context import require_hotel_id

    run = TranslationRun.objects.create(
        hotel_id=require_hotel_id(),
        languages=list(languages),
        groups=list(groups or []),
        started_by=user,
    )
    transaction.on_commit(lambda: _dispatch(run.pk, run.hotel_id))
    return run


def _dispatch(run_id, hotel_id) -> None:
    from apps.translate.tasks import run_translation

    run_translation.delay(str(run_id), str(hotel_id))


def execute(run: TranslationRun) -> TranslationRun:
    """Выполнить прогон здесь и сейчас. Зовётся задачей; отчёт — в строке прогона."""
    from apps.hotels.services.hotel import current_hotel

    hotel = current_hotel()
    source = hotel.default_language or "ru"
    keep = keep_words(hotel)
    provider = get_provider()
    targets = [code for code in (run.languages or []) if code != source]

    TranslationRun.objects.filter(pk=run.pk).update(
        status=TranslationRun.Status.RUNNING, started_at=timezone.now(), updated_at=timezone.now()
    )
    translated = skipped = failed = characters = calls = 0
    reasons: dict[str, int] = {}
    errors: list[dict] = []

    def note(reason: str) -> None:
        reasons[reason] = reasons.get(reason, 0) + 1

    for spec in specs_for(run.groups or None):
        from django.apps import apps as registry

        model = registry.get_model(spec.app_label, spec.model)
        if model is None:
            continue
        for row in model.objects.all():
            values = as_translations(getattr(row, spec.field, None), source)
            origin = (values.get(source) or "").strip()
            if not origin:
                continue
            changed = False
            for code in targets:
                current = (values.get(code) or "").strip()
                mark = TranslationMark.objects.filter(
                    app_label=spec.app_label, model=spec.model, object_id=row.pk,
                    field=spec.field, language=code,
                ).first()
                if current and (mark is None or mark.value_hash != _hash(current)):
                    # Писал человек — машина такое не трогает никогда.
                    skipped += 1
                    note("правка человека")
                    continue
                if current and mark is not None and mark.source_hash == _hash(origin):
                    skipped += 1
                    note("уже переведено машиной")
                    continue
                if is_only_proper_noun(origin, keep):
                    # Имя собственное: переносим как есть, модель не зовём и
                    # не платим за копию слова.
                    values[code] = origin
                    changed = True
                    translated += 1
                    note("имя собственное")
                    _mark(spec, row, code, origin, origin, 0)
                    continue
                try:
                    text = provider.translate(
                        TranslationRequest(
                            text=origin, source=source, target=code, keep=protected(origin, keep)
                        )
                    )
                except TranslationUnavailable as exc:
                    # ПОЛЕ ОСТАЁТСЯ ПУСТЫМ. Заглушка уехала бы в публикацию.
                    skipped += 1
                    note(exc.detail)
                    continue
                except Exception as exc:  # noqa: BLE001 — модель ответила не так
                    failed += 1
                    errors.append({"where": f"{spec.model}.{spec.field}", "id": str(row.pk), "error": str(exc)[:200]})
                    continue
                values[code] = text
                changed = True
                translated += 1
                calls += 1
                characters += len(origin)
                _mark(spec, row, code, origin, text, len(origin))
            if changed:
                setattr(row, spec.field, values)
                row.save(update_fields=[spec.field, "updated_at"])

    if calls or characters:
        _account(run.hotel_id, calls=calls, characters=characters)

    TranslationRun.objects.filter(pk=run.pk).update(
        status=TranslationRun.Status.DONE,
        finished_at=timezone.now(),
        translated=translated,
        skipped=skipped,
        failed=failed,
        characters=characters,
        report={
            "provider": provider.name,
            "connected": provider.connected,
            "reasons": reasons,
            "errors": errors[:50],
            "languages": targets,
        },
        updated_at=timezone.now(),
    )
    run.refresh_from_db()
    return run


def _mark(spec, row, language: str, origin: str, value: str, characters: int) -> None:
    TranslationMark.objects.update_or_create(
        hotel_id=row.hotel_id,
        app_label=spec.app_label,
        model=spec.model,
        object_id=row.pk,
        field=spec.field,
        language=language,
        defaults={
            "value_hash": _hash(value),
            "source_hash": _hash(origin),
            "characters": characters,
        },
    )


def _account(hotel_id, *, calls: int, characters: int) -> None:
    """
    Расход по месяцам отеля: без него один большой каталог съедает бюджет
    всего флота, и узнают об этом по счёту.
    """
    from django.db.models import F

    period = timezone.now().strftime("%Y-%m")
    usage, created = TranslationUsage.objects.get_or_create(
        hotel_id=hotel_id, period=period, defaults={"calls": calls, "characters": characters}
    )
    if not created:
        TranslationUsage.objects.filter(pk=usage.pk).update(
            calls=F("calls") + calls, characters=F("characters") + characters
        )


def serialize_run(run: TranslationRun) -> dict:
    return {
        "id": str(run.pk),
        "status": run.status,
        "languages": run.languages,
        "groups": run.groups,
        "translated": run.translated,
        "skipped": run.skipped,
        "failed": run.failed,
        "characters": run.characters,
        "report": run.report or {},
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "finished_at": run.finished_at.isoformat() if run.finished_at else None,
    }
