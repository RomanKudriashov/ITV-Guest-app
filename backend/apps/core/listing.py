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

from django.db.models import F, Q, QuerySet, TextField
from django.db.models.functions import Cast

DEFAULT_LIMIT = 100
MAX_LIMIT = 500


def clamp(limit: int | None, *, default: int = DEFAULT_LIMIT, maximum: int = MAX_LIMIT) -> int:
    """Предел из запроса — в разумные рамки. Ноль и минус означают «по умолчанию»."""
    if not limit or limit < 1:
        return default
    return min(limit, maximum)


def search(
    queryset: QuerySet,
    term: str | None,
    fields: Iterable[str],
    *,
    json_fields: Iterable[str] = (),
) -> QuerySet:
    """
    Поиск по перечисленным полям — ИЛИ по всем сразу.

    Поля выбираются ОСМЫСЛЕННЫЕ: те, по которым человек реально помнит запись
    (номер комнаты, имя сотрудника, код блюда). Искать по всем колонкам подряд
    — значит находить по внутреннему идентификатору и не находить по названию.

    `json_fields` — ПЕРЕВОДИМЫЕ поля (`{"ru": …, "en": …}`). Они лежат в JSONB,
    и обычный `icontains` по ним молча не находит ничего: сравнение идёт с
    объектом, а не с текстом. Поэтому такие поля приводятся к тексту — заодно
    и поиск получается сразу по всем языкам, что здесь и нужно: администратор
    ищет «Завтрак», не думая, на каком языке запись заводили.
    """
    term = (term or "").strip()
    if not term:
        return queryset

    condition = Q()
    for field in fields:
        condition |= Q(**{f"{field}__icontains": term})

    json_fields = list(json_fields)
    if json_fields:
        annotations = {f"_txt_{name.replace('__', '_')}": Cast(name, TextField())
                       for name in json_fields}
        queryset = queryset.annotate(**annotations)
        for alias in annotations:
            condition |= Q(**{f"{alias}__icontains": term})

    return queryset.filter(condition)


def sort(queryset: QuerySet, key: str | None, allowed: dict[str, str], default: str) -> QuerySet:
    """
    Сортировка по РАЗРЕШЁННОМУ ключу.

    Словарь `allowed` — не бюрократия: имя поля из строки запроса уходит прямо
    в `order_by`, и без белого списка запрос сортировал бы по чему угодно из
    модели, включая то, чего в выдаче нет.
    """
    return queryset.order_by(allowed.get((key or "").strip(), default))


def order(
    queryset: QuerySet,
    key: str | None,
    direction: str | None,
    allowed: dict[str, Any],
    *,
    default: Iterable[Any],
    then: Iterable[Any] = ("pk",),
) -> QuerySet:
    """
    Сортировка по столбцу, который выбрал человек (партия 62-F, Control).

    `allowed` — белый список: ключ из адреса → выражение (имя поля, `F`,
    аннотация) или СПИСОК выражений (первичный ключ и уточняющие). Чужой ключ —
    422 `invalid_sort`, а не тихая сортировка по умолчанию: ссылка с опечаткой
    должна сказать об этом, а не показать «какой-то» порядок.

    Пустые значения — В КОНЦЕ при любом направлении (`nulls_last`). При
    равенстве — `then` (по умолчанию `pk`): без него страницы курсора и
    повтор запроса могли бы переставить равные строки.
    """
    from django.db.models.expressions import Expression

    from apps.core.errors import ValidationError

    key = (key or "").strip()
    direction = (direction or "asc").strip()
    if not key:
        return queryset.order_by(*default, *then)
    if key not in allowed:
        raise ValidationError(
            "По этому столбцу сортировать нельзя",
            field="sort",
            code="invalid_sort",
            allowed=sorted(allowed),
        )
    if direction not in ("asc", "desc"):
        raise ValidationError("Направление сортировки — asc или desc", field="dir", code="invalid_sort")
    spec = allowed[key]
    exprs = spec if isinstance(spec, (list, tuple)) else [spec]
    ordering = []
    for expr in exprs:
        node = F(expr) if isinstance(expr, str) else expr
        if not isinstance(node, Expression) and not hasattr(node, "asc"):
            node = F(str(node))
        ordering.append(node.desc(nulls_last=True) if direction == "desc" else node.asc(nulls_last=True))
    return queryset.order_by(*ordering, *then)


def text_key(value: Any) -> str:
    """Текст для сравнения: без регистра, «ё» = «е»."""
    return str(value).replace("ё", "е").replace("Ё", "Е").casefold()


def natural_key(value: Any) -> tuple:
    """Номер «по-человечески»: (число головы, хвост) — 2 < 10 < 101, «3А» после «3»."""
    import re

    text = str(value).strip()
    match = re.match(r"^(\d+)(.*)$", text)
    if not match:
        return (1, 0, text_key(text))
    return (0, int(match.group(1)), text_key(match.group(2)))


def sort_rows(
    rows: list[Any],
    key: str | None,
    direction: str | None,
    allowed: dict[str, tuple],
    *,
    default: Any = None,
    then: Any = None,
) -> list[Any]:
    """
    Сортировка уже собранных строк — для выдач, которые фильтруются в Python
    (отели, номера, подключения). Те же правила, что у `order` и у экрана:

    `allowed[key] = (вид, достать)` или `(вид, достать, порядок_важности)`;
    вид — `text` | `natural` | `number` | `date` | `rank`. Пустое — в конце при
    любом направлении. При равенстве — `then(строка)` по возрастанию, затем
    исходный порядок. Чужой ключ — 422 `invalid_sort`.
    """
    from apps.core.errors import ValidationError

    key = (key or "").strip()
    direction = (direction or "asc").strip()
    if not key:
        return sorted(rows, key=default) if default else list(rows)
    if key not in allowed:
        raise ValidationError(
            "По этому столбцу сортировать нельзя",
            field="sort",
            code="invalid_sort",
            allowed=sorted(allowed),
        )
    if direction not in ("asc", "desc"):
        raise ValidationError("Направление сортировки — asc или desc", field="dir", code="invalid_sort")
    kind, getter, *rest = allowed[key]
    rank = list(rest[0]) if rest else []

    def empty(value: Any) -> bool:
        return value is None or value == ""

    def comparable(value: Any):
        if kind == "number":
            return float(value)
        if kind == "natural":
            return natural_key(value)
        if kind == "rank":
            return rank.index(value) if value in rank else len(rank)
        if kind == "date":
            return str(value)
        return text_key(value)

    filled = [row for row in rows if not empty(getter(row))]
    blank = [row for row in rows if empty(getter(row))]
    if then:
        filled.sort(key=then)
        blank.sort(key=then)
    filled.sort(key=lambda row: comparable(getter(row)), reverse=direction == "desc")
    return filled + blank


def natural(field: str):
    """
    Номер «по-человечески»: числовая голова, затем хвост как текст — 2 < 10 <
    101, «3А» после «3». Без этого «10» стояло бы перед «2».
    """
    from django.db.models import Func, IntegerField, Value
    from django.db.models.functions import Cast, Lower, NullIf

    head = Cast(
        NullIf(Func(F(field), Value(r"^(\d*).*$"), Value(r"\1"), function="regexp_replace"), Value("")),
        IntegerField(),
    )
    tail = Lower(Func(F(field), Value(r"^\d*"), Value(""), function="regexp_replace"))
    return [head, tail]


def russian(field):
    """Текст по-русски без регистра, «ё» = «е». Поле — имя или выражение."""
    from django.db.models import Func, TextField, Value
    from django.db.models.functions import Lower

    source = F(field) if isinstance(field, str) else field
    return Lower(Func(source, Value("ё"), Value("е"), function="replace", output_field=TextField()))


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
