"""
Сервисный слой аккаунтов: сессии гостя, вход персонала, роли, токены, 2FA.

Реэкспорт сессий сохранён: `accounts.services.create_guest_session` зовут из
гостевого контура по имени модуля.
"""

from __future__ import annotations

from .services import *  # noqa: F401,F403
