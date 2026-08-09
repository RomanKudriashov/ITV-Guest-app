"""
Сервисный слой заявок: создание, статусы, начисления, трекер.

Реэкспорт сохранён: `orders.services.create_order` и соседей зовут из шести
доменов, и переезд файла не повод переписывать их вызовы.
"""

from __future__ import annotations

from .services import *  # noqa: F401,F403
