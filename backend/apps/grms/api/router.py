"""
Сборка эндпоинтов управления номером снизу вверх.

Домен отдаёт три роутера: гостевой, CMS и он-прем. Он-прем вынесен отдельно
намеренно — у узла свой способ представиться (ключ), и класть его в один
роутер с гостевым или CMS значило бы однажды закрыть его чужой
аутентификацией.
"""

from __future__ import annotations

from ninja import Router

from .cms import access as cms_access
from .cms import catalog as cms_catalog
from .cms import imports as cms_imports
from .cms import plan as cms_plan
from .cms import types as cms_types
from .guest import room as guest_room
from .onprem import node as onprem_node

guest_router = guest_room.router

cms_router = Router()
cms_router.add_router("", cms_catalog.router)
cms_router.add_router("", cms_imports.router)
cms_router.add_router("", cms_types.router)
cms_router.add_router("", cms_access.router)
cms_router.add_router("", cms_plan.router)

onprem_router = onprem_node.router

__all__ = ["cms_router", "guest_router", "onprem_router"]
