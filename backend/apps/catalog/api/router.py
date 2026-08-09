"""
Сборка эндпоинтов каталога снизу вверх.

Домен отдаёт наружу ДВА роутера — гостевой и CMS, — а `api/` только цепляет их
к нужному префиксу и аутентификации. Так точка подключения не знает, из скольких
файлов собран домен, а домен не знает, под каким адресом его повесили.

Порядок вложения значим: Django резолвит URL по порядку регистрации, поэтому
статические пути объявлены раньше параметризованных ВНУТРИ каждого файла, а
файлы подключаются в том же порядке, в каком эндпоинты шли до переезда.
"""

from __future__ import annotations

from ninja import Router

from .cms import categories as cms_categories
from .cms import dictionaries as cms_dictionaries
from .cms import inclusions as cms_inclusions
from .cms import items as cms_items
from .cms import modifiers as cms_modifiers
from .guest import catalog as guest_catalog
from .guest import home as guest_home
from .guest import item as guest_item
from .guest import search as guest_search
from .guest import slots as guest_slots

guest_router = Router()
guest_router.add_router("", guest_catalog.router)
guest_router.add_router("", guest_item.router)
guest_router.add_router("", guest_slots.router)
guest_router.add_router("", guest_home.router)
guest_router.add_router("", guest_search.router)

cms_router = Router()
cms_router.add_router("", cms_categories.router)
cms_router.add_router("", cms_items.router)
cms_router.add_router("", cms_modifiers.router)
cms_router.add_router("", cms_dictionaries.router)
cms_router.add_router("", cms_inclusions.router)

__all__ = ["cms_router", "guest_router"]
