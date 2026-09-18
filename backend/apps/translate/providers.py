"""
МЕСТО ВЫЗОВА МОДЕЛИ — ОДНО.

Модели у нас пока нет: заказчик решил строить механизм, а перевод подключить
позже. Значит здесь ровно одна дверь, и подключение сведётся к замене слоя —
новый класс с тем же методом и строкой в настройках.

БЕЗ МОДЕЛИ МЫ НИЧЕГО НЕ ВЫДУМЫВАЕМ. Провайдер по умолчанию честно отвечает
«не подключено», поля остаются ПУСТЫМИ. Заглушка, похожая на перевод
(транслитерация, копия исходника, «[en] Салат»), уехала бы в публикацию, и
отель не отличил бы её от настоящего перевода — на превью бренда мы это уже
проходили.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from django.conf import settings
from django.utils.module_loading import import_string


class TranslationUnavailable(Exception):
    """Модель не подключена или не ответила. Причина — в тексте."""

    def __init__(self, detail: str = "Автоперевод пока не подключён", *, code: str = "translation_not_connected"):
        super().__init__(detail)
        self.detail = detail
        self.code = code


@dataclass(frozen=True)
class TranslationRequest:
    text: str
    source: str
    target: str
    # Слова, которые модель обязана оставить как есть: имена собственные.
    keep: tuple[str, ...] = ()


class TranslationProvider(Protocol):
    """Один метод: перевести текст. Всё остальное — дело сервиса."""

    name: str
    connected: bool

    def translate(self, request: TranslationRequest) -> str: ...


class NotConnectedProvider:
    """Заводское состояние: модели нет, и мы об этом говорим прямо."""

    name = "none"
    connected = False

    def translate(self, request: TranslationRequest) -> str:
        raise TranslationUnavailable()


def get_provider() -> TranslationProvider:
    """
    Провайдер по настройке. Имя живёт здесь и только здесь: подключить модель
    — строка в настройках и один новый класс с методом `translate`, а не поход
    по коду. Путь пишется через точку, как у любого бэкенда Django.
    """
    name = getattr(settings, "TRANSLATION_PROVIDER", "none")
    if name in ("", "none", None):
        return NotConnectedProvider()
    try:
        return import_string(name)()
    except ImportError as exc:
        raise TranslationUnavailable(
            f"Провайдер перевода «{name}» не найден: {exc}", code="unknown_translation_provider"
        ) from exc
