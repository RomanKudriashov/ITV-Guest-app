"""
ЭТАЛОН ПЛАТФОРМЫ И ЛОКАЛЬНОЕ ЗНАЧЕНИЕ — один механизм на все такие пары.

ПРАВИЛО, КОТОРОЕ ЗДЕСЬ ЗАФИКСИРОВАНО.

1. Не тронуто отелем — следует за эталоном. Правка эталона доезжает сама.
2. Тронуто — эталон не перетирает его НИКОГДА. Ни при правке, ни потом.
3. Расхождение не копится молча: платформа видит, кто разошёлся и по чему,
   и может предложить вернуть к эталону — явным действием, по одному отелю
   или по выбранным.

ПОЧЕМУ ОТДЕЛЬНЫЙ МОДУЛЬ И БЕЗ ORM. Пар такого рода у нас уже четыре: модули
отеля (намерение поверх гранта тарифа), порог SLA точки (пусто = умолчание
типа), коммерция сервиса (пусто = наследовать отель) и системный справочник
(копия строк). Решены они по-разному, и каждая следующая решалась бы заново.
Здесь — общая часть: сравнение и классификация. Как читать и как писать, знает
адаптер конкретной пары; он же отвечает за тенант-контекст и RLS.

ЧТО ЗНАЧИТ «НЕ ТРОНУТО». Признака «тронуто» в данных нет и заводить его
пришлось бы миграцией. Он и не нужен: в момент правки эталона мы ЗНАЕМ его
прежнее значение — копия, совпадающая с прежним, не тронута по определению.
Это же даёт перевод существующих пар без миграции данных.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class State(str, Enum):
    """Чем локальное значение отличается от эталона."""

    #: У отеля этой записи нет вовсе — эталон завели после него.
    MISSING = "missing"
    #: Значение отличается: отель его правил.
    CHANGED = "changed"
    #: Запись есть, но отель её погасил. Это ТОЖЕ решение отеля, а не поломка.
    DISABLED = "disabled"
    #: Своя запись отеля, которой в эталоне нет. Не расхождение — собственность.
    EXTRA = "extra"


@dataclass(slots=True)
class Divergence:
    key: tuple
    state: State
    source: dict | None
    local: dict | None


def is_untouched(local: dict | None, source: dict | None) -> bool:
    """
    Копия следует за эталоном?

    Сравниваем ПО ЗНАЧЕНИЯМ, которые сравнивает адаптер, а не по всей строке:
    порядок сортировки и время правки к вопросу «менял ли это человек»
    отношения не имеют.
    """
    if local is None or source is None:
        return False
    return local == source


def classify(source: dict[tuple, dict], local: dict[tuple, dict]) -> list[Divergence]:
    """
    Разложить копию относительно эталона.

    Чистая функция: ни запросов, ни контекста. Отсюда и её польза — адаптер
    любой следующей пары приносит два словаря и получает готовый разбор.
    """
    result: list[Divergence] = []

    for key, source_values in source.items():
        local_values = local.get(key)
        if local_values is None:
            result.append(Divergence(key, State.MISSING, source_values, None))
            continue
        if local_values.get("is_active") is False and source_values.get("is_active") is not False:
            result.append(Divergence(key, State.DISABLED, source_values, local_values))
            continue
        if not is_untouched(local_values, source_values):
            result.append(Divergence(key, State.CHANGED, source_values, local_values))

    for key, local_values in local.items():
        if key not in source:
            result.append(Divergence(key, State.EXTRA, None, local_values))

    return result


def summarize(divergences: list[Divergence]) -> dict[str, int]:
    """
    Числа для экрана. `extra` считается отдельно и НЕ входит в «разошлось»:
    своя запись отеля — это не расхождение с эталоном, а его собственность, и
    предлагать «вернуть к эталону» тут нечего.
    """
    counts = {state.value: 0 for state in State}
    for item in divergences:
        counts[item.state.value] += 1
    counts["diverged"] = counts[State.MISSING] + counts[State.CHANGED] + counts[State.DISABLED]
    return counts
