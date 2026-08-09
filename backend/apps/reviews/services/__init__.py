"""
Сервисный слой отзывов.

Реэкспорт сохранён: снаружи отзывы зовут как `review_svc.create_review`,
и переезд одного файла не повод менять вызовы в чужих доменах.
"""

from __future__ import annotations

from .reviews import *  # noqa: F401,F403
