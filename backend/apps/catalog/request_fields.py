"""
Типы полей заявки: разбор и проверка значения.

Единственное место проекта с разветвлением по типу — и оно про **тип поля**
(text/number/date/…), а не про тип услуги. Различия собраны таблицей, чтобы
добавление типа поля было новой строкой, а не новым `elif` в трёх местах.

Валидация делается на сервере всегда, даже если форма уже всё проверила:
значение попадает в снимок заявки и уходит исполнителю, а «телефон гостя
проверил» — не гарантия.
"""

from __future__ import annotations

import dataclasses
from datetime import date, time
from typing import Any, Callable

from django.db import models

from apps.core.errors import ValidationError


class FieldType(models.TextChoices):
    TEXT = "text", "Текст"
    NUMBER = "number", "Число"
    COUNT = "count", "Количество"
    DATE = "date", "Дата"
    TIME = "time", "Время"
    SELECT = "select", "Выбор из списка"


# Типы, у которых осмысленны границы min/max.
BOUNDED_TYPES = {FieldType.NUMBER, FieldType.COUNT}

MAX_TEXT_LENGTH = 500


@dataclasses.dataclass(slots=True)
class ParsedValue:
    """Что кладём в снимок: машинное значение и человекочитаемая подпись."""

    value: Any
    display: str


def _fail(field, message: str, code: str = "field_invalid") -> None:
    raise ValidationError(message, field=field.code, code=code)


def _parse_text(raw: Any, field) -> ParsedValue:
    text = str(raw).strip()
    if len(text) > MAX_TEXT_LENGTH:
        _fail(field, f"«{field.label_i18n}»: слишком длинный ответ")
    return ParsedValue(text, text)


def _parse_number(raw: Any, field) -> ParsedValue:
    try:
        number = float(str(raw).replace(",", "."))
    except (TypeError, ValueError):
        _fail(field, f"«{field.label_i18n}»: нужно число")
    _check_bounds(number, field)
    # Целое показываем без хвоста: «3», а не «3.0».
    display = str(int(number)) if number == int(number) else str(number)
    return ParsedValue(number, display)


def _parse_count(raw: Any, field) -> ParsedValue:
    try:
        count = int(str(raw).strip())
    except (TypeError, ValueError):
        _fail(field, f"«{field.label_i18n}»: нужно целое число")
    if count < 0:
        _fail(field, f"«{field.label_i18n}»: количество не может быть отрицательным")
    _check_bounds(count, field)
    return ParsedValue(count, str(count))


def _check_bounds(number: float, field) -> None:
    if field.min_value is not None and number < field.min_value:
        _fail(field, f"«{field.label_i18n}»: минимум {field.min_value}", code="field_out_of_range")
    if field.max_value is not None and number > field.max_value:
        _fail(field, f"«{field.label_i18n}»: максимум {field.max_value}", code="field_out_of_range")


def _parse_date(raw: Any, field) -> ParsedValue:
    text = str(raw).strip()
    try:
        parsed = date.fromisoformat(text)
    except ValueError:
        _fail(field, f"«{field.label_i18n}»: дата в формате ГГГГ-ММ-ДД")
    return ParsedValue(parsed.isoformat(), parsed.strftime("%d.%m.%Y"))


def _parse_time(raw: Any, field) -> ParsedValue:
    parts = str(raw).strip().split(":")
    if len(parts) not in (2, 3):
        _fail(field, f"«{field.label_i18n}»: время в формате ЧЧ:ММ")
    try:
        parsed = time(*(int(part) for part in parts))
    except (TypeError, ValueError):
        _fail(field, f"«{field.label_i18n}»: время в формате ЧЧ:ММ")
    return ParsedValue(parsed.strftime("%H:%M"), parsed.strftime("%H:%M"))


def _parse_select(raw: Any, field) -> ParsedValue:
    value = str(raw).strip()
    options = field.options or []
    match = next((option for option in options if str(option.get("value")) == value), None)
    if match is None:
        allowed = ", ".join(str(option.get("value")) for option in options)
        _fail(field, f"«{field.label_i18n}»: допустимые варианты — {allowed}")

    from apps.core.fields import translate

    return ParsedValue(value, translate(match.get("label"), None) or value)


PARSERS: dict[str, Callable[[Any, Any], ParsedValue]] = {
    FieldType.TEXT: _parse_text,
    FieldType.NUMBER: _parse_number,
    FieldType.COUNT: _parse_count,
    FieldType.DATE: _parse_date,
    FieldType.TIME: _parse_time,
    FieldType.SELECT: _parse_select,
}


def is_blank(raw: Any) -> bool:
    return raw is None or (isinstance(raw, str) and not raw.strip())


def parse_field_value(field, raw: Any, *, language: str | None = None) -> ParsedValue:
    parser = PARSERS.get(field.field_type, _parse_text)
    return parser(raw, field)


def build_field_snapshot(fields: list, values: dict[str, Any], *, language: str | None = None) -> list[dict]:
    """
    Проверяет ответы и собирает снимок для заказа.

    Снимок, а не ссылки на поля: заявка обязана пережить переименование и
    удаление полей в CMS — исполнитель должен видеть, о чём его просили,
    даже если услугу потом перенастроили.
    """
    from apps.core.fields import translate

    known = {field.code for field in fields}
    unknown = sorted(set(values or {}) - known)
    if unknown:
        raise ValidationError(
            f"Неизвестные поля заявки: {', '.join(unknown)}",
            code="field_unknown",
            field=unknown[0],
        )

    snapshot: list[dict] = []
    for field in fields:
        raw = (values or {}).get(field.code)
        if is_blank(raw):
            if field.is_required:
                raise ValidationError(
                    f"Заполните «{translate(field.label, language) or field.code}»",
                    field=field.code,
                    code="field_required",
                )
            continue

        parsed = parse_field_value(field, raw, language=language)
        snapshot.append(
            {
                "code": field.code,
                "label": dict(field.label or {}),
                "field_type": field.field_type,
                "value": parsed.value,
                "display": parsed.display,
            }
        )
    return snapshot
