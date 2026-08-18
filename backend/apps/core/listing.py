"""
Общий контракт списков: поиск, фильтры, сортировка, листание.

ОДИН МЕХАНИЗМ, А НЕ СЕМЬ. Списков в двух приложениях под два десятка, и до
этого модуля каждый решал свои задачи по-своему: у флота был поиск с
сортировкой, у журнала — курсор с фильтрами, у всех выдач CMS не было ничего,
даже предела. Разные ответы на один вопрос означают, что оператор на каждом
экране заново угадывает, что здесь умеют.

ФИЛЬТРУЕТ СЕРВЕР. Не «скачали страницу и отсеяли на клиенте»: так уже было
сделано в журнале платформы (фильтр по поддомену), и это врало счётчиком —
экран показывал «3 записи» там, где в базе их было триста, просто остальные
не попали в скачанную сотню.

ДВА СПОСОБА ЛИСТАТЬ, И ЭТО НЕ ВКУСОВЩИНА:
  * СТРАНИЦАМИ — где набор при просмотре не меняется (номера, персонал, меню).
    Дёшево, даёт «страница 3 из 12» и переход к любой странице;
  * КУРСОРОМ — где записи добавляются прямо во время просмотра (журнал,
    история, заказы). При смещении вторая страница показала бы часть первой,
    а часть записей не показала бы вовсе — и разыскиваемое оказалось бы ровно
    в пропущенном.
"""

from __future__ import annotations

from typing import Any, Iterable

from django.db.models import Q, QuerySet

DEFAULT_LIMIT = 100
MAX_LIMIT = 500


def clamp(limit: int | None, *, default: int = DEFAULT_LIMIT, maximum: int = MAX_LIMIT) -> int:
    """Предел из запроса — в разумные рамки. Ноль и минус означают «по умолчанию»."""
    if not limit or limit < 1:
        return default
    return min(limit, maximum)


def search(queryset: QuerySet, term: str | None, fields: Iterable[str]) -> QuerySet:
    """
    Поиск по перечисленным полям — ИЛИ по всем сразу.

    Поля выбираются ОСМЫСЛЕННЫЕ: те, по которым человек реально помнит запись
    (номер комнаты, имя сотрудника, код блюда). Искать по всем колонкам подряд
    — значит находить по внутреннему идентификатору и не находить по названию.
    """
    term = (term or "").strip()
    if not term:
        return queryset
    condition = Q()
    for field in fields:
        condition |= Q(**{f"{field}__icontains": term})
    return queryset.filter(condition)


def sort(queryset: QuerySet, key: str | None, allowed: dict[str, str], default: str) -> QuerySet:
    """
    Сортировка по РАЗРЕШЁННОМУ ключу.

    Словарь `allowed` — не бюрократия: имя поля из строки запроса уходит прямо
    в `order_by`, и без белого списка запрос сортировал бы по чему угодно из
    модели, включая то, чего в выдаче нет.
    """
    return queryset.order_by(allowed.get((key or "").strip(), default))


def envelope(rows: list[Any], total: int, limit: int, **extra: Any) -> dict[str, Any]:
    """
    Выдача с честным хвостом.

    `truncated` — не украшение: по нему интерфейс говорит «показаны первые N
    из M», а не делает вид, что показал всё.
    """
    return {
        "items": rows,
        "total": total,
        "limit": limit,
        "truncated": total > len(rows),
        **extra,
    }


def page(
    queryset: QuerySet,
    *,
    limit: int | None = None,
    offset: int = 0,
    serialize=None,
) -> dict[str, Any]:
    """
    Страница по смещению — для наборов, которые при просмотре не меняются.

    `total` считается ДО среза: иначе «показаны 25 из 25» врало бы на каждом
    списке длиннее страницы.
    """
    limit = clamp(limit)
    offset = max(0, offset or 0)
    total = queryset.count()
    rows = list(queryset[offset : offset + limit])
    items = [serialize(row) for row in rows] if serialize else rows
    return envelope(items, total, limit, offset=offset)
