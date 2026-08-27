"""
Системный справочник: эталон платформы и копии отелей.

ПЕРВЫЙ ПОТРЕБИТЕЛЬ общего механизма (`inheritance.py`) — и выбран он потому,
что здесь расхождение уже копилось молча.

ЧТО БЫЛО НА САМОМ ДЕЛЕ. Докстрока модели обещала, что правка эталона достаётся
отелям, заведённым после неё. Это было неверно: копии отелю нарезает
`provisioning.seed_item_data_dictionaries()`, и читал он КОНСТАНТЫ КОДА
(`catalog.vocabularies`), а не таблицу эталона. Запись, добавленная в консоли,
не доезжала ни до существующих отелей, ни до новых — вообще ни до кого.

ЧТО СТАЛО.

* Новый отель получает копии ИЗ ЭТАЛОНА — таблица стала единственным источником.
* Правка эталона доезжает до тех, кто её не трогал: копия, совпадающая с
  ПРЕЖНИМ значением эталона, не тронута по определению.
* Тронутая копия остаётся как есть — всегда. Расхождение видно на экране
  числом и по записям, и возвращается к эталону только явным действием.

ЦЕНА, НАЗВАННАЯ ВСЛУХ. Правка эталона проходит по всем отелям: тенантные
таблицы под RLS, и писать в них можно только войдя в контекст каждого. На
двухстах отелях это двести контекстов в одном запросе. Для справочника это
приемлемо — четырнадцать аллергенов меняются законом, а не ежедневно; для
будущей массовой публикации контента так делать нельзя, там нужна фоновая
операция с отчётом по каждому отелю.
"""

from __future__ import annotations

from apps.core.context import tenant_context
from apps.hotels.models import Hotel, SystemDictionaryEntry
from apps.hotels.services import inheritance

# Что сравниваем у записи. Порядок сортировки НЕ входит: он про вид списка, а
# не про содержание, и отличие в нём не означает, что отель правил запись.
COMPARED = ("title", "is_active")

# Событий рассылки СВОИХ НЕТ намеренно: числа «обновлено / оставлено / создано»
# уходят в payload той самой записи `platform.dictionary.updated`, которая
# описывает правку эталона. Отдельное событие рядом с ней говорило бы о том же
# факте вторым голосом — и разошлось бы с первым при первой же правке.


def _model(kind: str):
    from apps.catalog.models import Allergen, DietaryMarker

    return Allergen if kind == SystemDictionaryEntry.Kind.ALLERGEN else DietaryMarker


def _values(obj) -> dict:
    return {field: getattr(obj, field) for field in COMPARED}


def source_map() -> dict[tuple, dict]:
    """Эталон: {(вид, код): значения}."""
    return {
        (entry.kind, entry.code): _values(entry)
        for entry in SystemDictionaryEntry.objects.all()
    }


def local_map(hotel: Hotel) -> dict[tuple, dict]:
    """Копии отеля. Только СИСТЕМНЫЕ: свои записи отеля эталона не касаются."""
    from apps.catalog.models import Allergen, DietaryMarker

    result: dict[tuple, dict] = {}
    with tenant_context(hotel):
        for kind, model in (
            (SystemDictionaryEntry.Kind.ALLERGEN, Allergen),
            (SystemDictionaryEntry.Kind.MARKER, DietaryMarker),
        ):
            for row in model.objects.filter(is_system=True):
                result[(kind, row.code)] = _values(row)
    return result


def entries_from_source() -> dict[str, list[dict]]:
    """
    Записи эталона для нарезки новому отелю.

    Заведение отеля читает ЭТУ функцию, а не константы кода: иначе таблица
    эталона и то, что получает отель, живут двумя разными жизнями — ровно то,
    из-за чего добавленная в консоли запись не доезжала ни до кого.
    """
    result: dict[str, list[dict]] = {kind: [] for kind in SystemDictionaryEntry.Kind.values}
    for entry in SystemDictionaryEntry.objects.order_by("kind", "sort_order", "code"):
        result[entry.kind].append(
            {
                "code": entry.code,
                "title": entry.title,
                "is_active": entry.is_active,
                "sort_order": entry.sort_order,
            }
        )
    return result


# --- Распространение правки -------------------------------------------------


def propagate(entry: SystemDictionaryEntry, before: dict | None) -> dict[str, int]:
    """
    Разослать правку эталона тем, кто её не трогал.

    `before` — значения записи ДО правки; None для новой записи. Копия,
    совпадающая с `before`, не тронута и обновляется. Всё остальное остаётся
    как есть и попадает в расхождения.

    Возвращает {updated, kept, created}: «обновлено 40, у 3 своя правка» —
    ответ, ради которого это число и показывают.
    """
    model = _model(entry.kind)
    after = _values(entry)

    updated = kept = created = 0
    for hotel in Hotel.objects.all():
        with tenant_context(hotel):
            row = model.objects.filter(code=entry.code, is_system=True).first()
            if row is None:
                # Записи у отеля нет: новая запись эталона. Нарезаем — это не
                # перетирание чужого, а появление того, чего не было.
                model.objects.create(
                    code=entry.code,
                    title=entry.title,
                    is_active=entry.is_active,
                    is_system=True,
                    sort_order=entry.sort_order,
                )
                created += 1
                continue

            if not inheritance.is_untouched(_values(row), before):
                kept += 1
                continue

            for field, value in after.items():
                setattr(row, field, value)
            row.save(update_fields=[*after.keys(), "updated_at"])
            updated += 1

    return {"updated": updated, "kept": kept, "created": created}


# --- Расхождения ------------------------------------------------------------


def report(*, limit: int | None = None) -> dict:
    """
    Кто разошёлся с эталоном и по чему.

    Считается ПЕРЕСЧЁТОМ, а не хранимым признаком: хранимый разошёлся бы с
    правдой при первой же правке мимо этого пути.
    """
    source = source_map()
    hotels = Hotel.objects.all()
    if limit:
        hotels = hotels[:limit]

    rows = []
    diverged_hotels = 0
    for hotel in hotels:
        divergences = inheritance.classify(source, local_map(hotel))
        counts = inheritance.summarize(divergences)
        if counts["diverged"]:
            diverged_hotels += 1
        rows.append(
            {
                "hotel_id": str(hotel.pk),
                "name": hotel.name_i18n,
                "subdomain": hotel.subdomain,
                "counts": counts,
                "entries": [
                    {
                        "kind": item.key[0],
                        "code": item.key[1],
                        "state": item.state.value,
                        "source": _printable(item.source),
                        "local": _printable(item.local),
                    }
                    for item in divergences
                    if item.state is not inheritance.State.EXTRA
                ],
            }
        )

    return {
        "hotels": rows,
        "source_size": len(source),
        # Число для заголовка: «разошлись 3 отеля из 15» — то, ради чего экран
        # вообще открывают.
        "diverged_hotels": diverged_hotels,
        "total_hotels": len(rows),
    }


def _printable(values: dict | None) -> dict | None:
    """Значения в вид, пригодный для JSON (title — уже словарь переводов)."""
    return dict(values) if values else None


def reset(hotel_ids: list[str], *, codes: list[str] | None = None) -> dict[str, int]:
    """
    Вернуть копии к эталону — ЯВНОЕ действие оператора.

    `codes` — какие записи возвращать; пусто — все. Свои записи отеля не
    трогаются никогда: у них нет эталона, возвращать их не к чему.
    """
    source = source_map()
    restored = created = 0

    for hotel in Hotel.objects.filter(pk__in=hotel_ids):
        with tenant_context(hotel):
            for (kind, code), values in source.items():
                if codes and code not in codes:
                    continue
                model = _model(kind)
                row = model.objects.filter(code=code, is_system=True).first()
                if row is None:
                    model.objects.create(code=code, is_system=True, **values)
                    created += 1
                    continue
                if _values(row) == values:
                    continue
                for field, value in values.items():
                    setattr(row, field, value)
                row.save(update_fields=[*values.keys(), "updated_at"])
                restored += 1

    return {"restored": restored, "created": created}
