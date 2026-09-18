"""Модель-двойник: перевод без сети и без счёта."""

from __future__ import annotations

from apps.translate.providers import TranslationRequest


class FakeProvider:
    """
    Переводит предсказуемо: «[en] Салат». Настоящая модель нам не нужна —
    проверяем механизм вокруг вызова, а не качество перевода.
    """

    name = "fake"
    connected = True
    calls: list[TranslationRequest] = []

    def translate(self, request: TranslationRequest) -> str:
        FakeProvider.calls.append(request)
        return f"[{request.target}] {request.text}"


class BrokenProvider:
    """Модель ответила не так: прогон обязан устоять и записать строку в отчёт."""

    name = "broken"
    connected = True

    def translate(self, request: TranslationRequest) -> str:
        raise RuntimeError("модель вернула мусор")
