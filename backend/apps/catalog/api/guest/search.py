"""Глобальный поиск гостя."""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.accounts.services.auth import GuestAuth
from apps.catalog.services.search import search, suggestions_of
from apps.core.context import current_language

router = Router(tags=["guest-surface"])
guest_auth = GuestAuth()


@router.get("/search", auth=guest_auth, summary="Глобальный поиск гостя")
def guest_search(request: HttpRequest, q: str = ""):
    """
    Поиск по всему, что отель показывает гостю: заведения, позиции, инфо.

    ОТЕЛЬ БЕРЁТСЯ ИЗ СЕССИИ, а не из запроса. Это единственное место продукта,
    куда гость передаёт произвольный текст, и подмешать сюда чужой отель нельзя
    ничем: ни параметром, ни заголовком — их тут просто нет.
    """
    language = current_language()
    hotel = request.hotel
    result = search(hotel, q, language=language)
    # Подсказки едут вместе с результатом: пустое поле показывает их, и
    # отдельный запрос ради трёх строк был бы лишним обменом.
    result["suggestions"] = suggestions_of(hotel, language)
    return result
