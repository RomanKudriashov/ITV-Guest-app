"""
Переводимые поля — единая схема для всего проекта.

Хранение: JSONB вида {"ru": "Салат «Цезарь»", "en": "Caesar salad"}.
Чтение:   аксессор `<field>_i18n` отдаёт строку на нужном языке с фолбэком.

    class Item(TenantModel):
        title = TranslatableField()

    item.title            # {"ru": "...", "en": "..."} — сырое, для CMS
    item.title_i18n       # строка на языке текущего контекста
    item.tr("title", "ar")# явный язык

Порядок фолбэка: запрошенный язык → язык отеля по умолчанию →
DEFAULT_LANGUAGE (en) → любое непустое значение. Пустая строка вместо KeyError:
недопереведённый контент не должен ронять выдачу меню гостю.
"""

from __future__ import annotations

from typing import Any

from django.conf import settings
from django.db import models

from .context import current_hotel_language, current_language


def translate(
    value: Any, language: str | None = None, *, fallback_language: str | None = None
) -> str:
    """
    Разворачивает {lang: value} в строку. Терпимо к мусору на входе.

    ЯЗЫК ОТЕЛЯ ВСТРОЕН В ЦЕПОЧКУ, а не передаётся вызывающим.

    Раньше второй эшелон фолбэка был необязательным параметром, и из 68 мест
    вызова его передавало ровно одно — аксессор `<field>_i18n`. Остальные 67
    (меню, витрина, трекер, поиск, письма) шли сразу к DEFAULT_LANGUAGE, а
    оттуда — к «любому непустому», то есть к первому ключу словаря по порядку:
    в отеле, который ведёт контент по-русски и по-английски, гость с китайским
    интерфейсом получал арабское название, потому что «ar» стоит первым.

    Чинить это в 67 местах — значит завести 68-е, где снова забудут. Поэтому
    язык отеля берётся из контекста запроса здесь, а явный
    `fallback_language` остаётся приоритетнее: он точнее контекста там, где
    объект знает свой отель сам.
    """
    if not value:
        return ""
    if isinstance(value, str):
        return value
    if not isinstance(value, dict):
        return str(value)

    candidates = [
        language or current_language(),
        fallback_language or current_hotel_language(),
        settings.DEFAULT_LANGUAGE,
    ]
    for lang in candidates:
        if lang and value.get(lang):
            return str(value[lang])
    for candidate in value.values():
        if candidate:
            return str(candidate)
    return ""


def as_translations(value: Any, language: str) -> dict[str, str]:
    """
    Переводимое поле СЛОВАРЁМ — что бы в нём ни лежало.

    `translate()` терпим к мусору на чтении, а вот пишущие места делали
    `dict(value or {})` и падали `ValueError` на голой строке. Строка там
    берётся не из воздуха: поля становились переводимыми по одному, и на
    стендах, переживших такой перевод, часть строк осталась плоской. Сид
    названий отеля ронялся ровно на этом — то есть пересеять стенд было нельзя.

    Плоское значение — это перевод на язык, который у объекта тогда был
    единственным: его и кладём под `language`, ничего не теряя.
    """
    if isinstance(value, dict):
        return {code: text for code, text in value.items()}
    if isinstance(value, str) and value.strip():
        return {language: value}
    return {}


class TranslatedAccessor:
    """Дескриптор `<field>_i18n`: читает язык из контекста запроса."""

    def __init__(self, field_name: str) -> None:
        self.field_name = field_name

    def __get__(self, instance, owner=None) -> Any:
        if instance is None:
            return self
        raw = getattr(instance, self.field_name)
        return translate(raw, fallback_language=_hotel_default_language(instance))


def _hotel_default_language(instance: Any) -> str | None:
    """Язык отеля как второй эшелон фолбэка — если модель знает свой отель."""
    hotel = getattr(instance, "hotel", None)
    return getattr(hotel, "default_language", None)


class TranslatableField(models.JSONField):
    """
    JSONB {lang: value} + автоматический аксессор `<name>_i18n`.

    Наследовать/переопределять не нужно: единообразие переводимых полей —
    требование архитектуры, а не вкусовщина.
    """

    description = "Переводимое поле {lang: value}"

    def __init__(self, *args, **kwargs):
        kwargs.setdefault("default", dict)
        kwargs.setdefault("blank", True)
        super().__init__(*args, **kwargs)

    def deconstruct(self):
        name, path, args, kwargs = super().deconstruct()
        if kwargs.get("default") is dict:
            del kwargs["default"]
        if kwargs.get("blank") is True:
            del kwargs["blank"]
        return name, "apps.core.fields.TranslatableField", args, kwargs

    def contribute_to_class(self, cls, name, **kwargs):
        super().contribute_to_class(cls, name, **kwargs)
        setattr(cls, f"{name}_i18n", TranslatedAccessor(name))


class TranslatableMixin:
    """Точечный доступ к переводу с явным языком: obj.tr("title", "ar")."""

    def tr(self, field_name: str, language: str | None = None) -> str:
        return translate(
            getattr(self, field_name),
            language,
            fallback_language=_hotel_default_language(self),
        )
