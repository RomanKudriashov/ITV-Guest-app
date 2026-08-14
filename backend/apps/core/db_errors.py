"""
Нарушение уникальности → человеческий отказ, а не «что-то пошло не так».

ЗАЧЕМ ОДНА ТОЧКА. Уникальные индексы не знают про `deleted_at`: мягко
удалённая строка видна им наравне с живой. Поэтому «удалить и завести заново»
роняло `IntegrityError` в восьми проверенных местах — и оператор получал 500,
то есть сообщение «платформа сломалась» вместо «код занят». Чинить это
поручно значит чинить ровно те ручки, которые уже нашли: следующая появится
без обработки и повторит ту же пятисотку. Здесь — общий разбор, и он работает
для ручек, которых ещё нет.

ЧЕГО ЗДЕСЬ НЕТ. Это НЕ освобождение ключа. Занятый мягко удалённой строкой
код так и остаётся занятым, и текст обязан это сказать: иначе оператор видит
пустой список, свободный на вид код — и отказ без объяснения.

ЧТО НЕ ПЕРЕХВАТЫВАЕТСЯ. Только нарушение уникальности. Внешние ключи,
NOT NULL и проверочные ограничения — по-прежнему ошибка сервера: это дефекты
кода, и вежливый 409 их бы просто спрятал от того, кто чинит.

ПОЧЕМУ РАЗБОР ИДЁТ ПО ИМЕНИ ОГРАНИЧЕНИЯ, А НЕ ПО ТЕКСТУ ОШИБКИ. Postgres
кладёт значения ключа в DETAIL («Key (code)=(breakfast) already exists»), но
под RLS не кладёт: значения принадлежат строке, которую сессии видеть не
положено, и сервер молчит о ней целиком. У нас RLS включён на всех тенантных
таблицах, поэтому DETAIL там пуст всегда. Остаётся имя ограничения — оно
приходит всегда и однозначно указывает на модель и поля; значение берётся из
тела запроса, то есть из того, что человек только что ввёл.
"""

from __future__ import annotations

import json
import re
from typing import Any

from django.db import IntegrityError, connections

# Название поля → слово, которым его зовут в разговоре. Не verbose_name: он в
# проекте английский и автогенерённый, а отказ читает русскоязычный оператор.
_WORDS = {
    "code": "код",
    "subdomain": "поддомен",
    "custom_domain": "домен",
    "email": "адрес",
    "name": "название",
    "number": "номер",
    "key": "ключ",
    "dedupe_key": "ключ",
    "version": "версия",
    "kind": "вид",
}

# Поля, которые в отказе не называют: их выбирал не человек.
_SILENT = {"hotel", "hotel_id", "deleted_at", "room_type", "service", "flow"}

_DETAIL = re.compile(r"Key \((?P<cols>.+?)\)=\((?P<vals>.+)\) already exists", re.S)


def _unique_violation(exc: BaseException) -> Any | None:
    """Развернуть до psycopg-ошибки и убедиться, что это именно уникальность."""
    try:
        from psycopg import errors as pg_errors
    except ImportError:  # pragma: no cover — psycopg есть всегда
        return None

    for candidate in (exc, exc.__cause__, getattr(exc, "__context__", None)):
        if isinstance(candidate, pg_errors.UniqueViolation):
            return candidate
    return None


def _model_for(table: str):
    from django.apps import apps

    return next((m for m in apps.get_models() if m._meta.db_table == table), None)


def _fields_of_constraint(model, name: str) -> list[str]:
    """Какие поля перечислены в нарушенном ограничении."""
    if not name:
        return []
    for constraint in model._meta.constraints:
        if getattr(constraint, "name", "") == name and getattr(constraint, "fields", None):
            return list(constraint.fields)
    # Уникальность одного поля Postgres называет `<таблица>_<колонка>_key`.
    table = model._meta.db_table
    if name.startswith(f"{table}_") and name.endswith("_key"):
        column = name[len(table) + 1 : -len("_key")]
        field = next((f for f in model._meta.fields if f.column == column), None)
        if field is not None:
            return [field.name]
    return []


def _values_from_detail(violation) -> dict[str, str]:
    """Значения из DETAIL — там, где Postgres их отдал (нетенантные таблицы)."""
    detail = getattr(violation.diag, "message_detail", "") or ""
    match = _DETAIL.search(detail)
    if not match:
        return {}
    cols = [c.strip() for c in match.group("cols").split(",")]
    vals = [v.strip() for v in match.group("vals").split(",")]
    return dict(zip(cols, vals)) if len(cols) == len(vals) else {}


def _values_from_request(request, fields: list[str]) -> dict[str, str]:
    """
    Значение из тела запроса — то, что человек только что ввёл.

    Единственный источник под RLS, где Postgres о значениях молчит. Тело уже
    прочитано ninja и закэшировано, повторное чтение ничего не ломает.
    """
    if request is None:
        return {}
    try:
        payload = json.loads(request.body or b"{}")
    except Exception:  # noqa: BLE001 — не JSON, не форма, не важно
        return {}
    if not isinstance(payload, dict):
        return {}
    return {f: str(payload[f]) for f in fields if isinstance(payload.get(f), (str, int))}


def _lookup_for(model, fields: list[str], values: dict[str, str]) -> dict[str, Any]:
    """
    Собрать точный запрос по всем полям ограничения.

    Тенантное поле в теле запроса не приходит и приходить не должно: отель
    берётся из контекста, а не из того, что прислал клиент. Поэтому его сюда
    подставляем сами — иначе ни одно составное ограничение (а их
    большинство: `hotel` + `code`) не удалось бы проверить, и каждый отказ
    сваливался бы в размытое «возможно, удалённой».
    """
    from .context import current_hotel_id

    lookup: dict[str, Any] = {}
    for field in fields:
        if field in values:
            lookup[field] = values[field]
            continue
        if field in ("hotel", "hotel_id"):
            hotel_id = current_hotel_id()
            if hotel_id is None:
                return {}
            lookup["hotel_id"] = hotel_id
            continue
        return {}
    return lookup


def _is_taken_by_deleted(model, lookup: dict[str, Any]) -> bool | None:
    """
    Занято живой строкой или удалённой? Ответ меняет текст, поэтому спрашиваем.

    `None` — «не знаю»: соединение может быть в оборванной транзакции, и
    лишний запрос в ней заменил бы внятный отказ на новую ошибку. Не знаем —
    говорим общими словами, а не выдумываем.
    """
    if not lookup or not hasattr(model, "all_objects"):
        return None
    if not any(f.name == "deleted_at" for f in model._meta.fields):
        return None
    if any(c.in_atomic_block and c.needs_rollback for c in connections.all()):
        return None
    try:
        return model.all_objects.filter(**lookup, deleted_at__isnull=False).exists()
    except Exception:  # noqa: BLE001 — диагностика не имеет права ломать отказ
        return None


def unique_conflict(exc: IntegrityError, request=None) -> dict | None:
    """
    Разобрать ошибку в готовый ответ 409 — или вернуть None, если это не
    нарушение уникальности и трогать её нельзя.
    """
    violation = _unique_violation(exc)
    if violation is None:
        return None

    generic = {
        "detail": (
            "Такое значение уже занято — возможно, записью, удалённой ранее: "
            "удалённые записи продолжают занимать своё значение."
        ),
        "code": "unique_conflict",
        "blocked_by": "unknown",
    }

    model = _model_for(getattr(violation.diag, "table_name", "") or "")
    if model is None:
        return generic

    fields = _fields_of_constraint(model, getattr(violation.diag, "constraint_name", "") or "")
    if not fields:
        return generic

    by_column = _values_from_detail(violation)
    values = {
        f: by_column.get(
            next((fl.column for fl in model._meta.fields if fl.name == f), f), ""
        )
        for f in fields
    }
    values = {f: v for f, v in values.items() if v}
    values.update(_values_from_request(request, fields))

    named = [f for f in fields if f not in _SILENT] or fields
    field = named[0]
    value = values.get(field, "")
    word = _WORDS.get(field, field)
    subject = f"{word.capitalize()} «{value}»" if value else word.capitalize()

    deleted = _is_taken_by_deleted(model, _lookup_for(model, fields, values))

    if deleted is True:
        detail = (
            f"{subject} занят удалённой записью. Удалённые записи продолжают "
            f"занимать своё значение, поэтому свободным оно только выглядит — "
            f"выберите другое."
        )
    elif deleted is False:
        detail = f"{subject} уже занят."
    else:
        detail = (
            f"{subject} уже занят — возможно, записью, удалённой ранее: "
            f"удалённые записи продолжают занимать своё значение."
        )

    payload: dict = {"detail": detail, "code": "unique_conflict", "field": field}
    if value:
        payload["value"] = value
    # Занято живым или удалённым — разные действия оператора, и клиенту это
    # видно без разбора текста.
    payload["blocked_by"] = {True: "deleted", False: "active", None: "unknown"}[deleted]
    return payload
