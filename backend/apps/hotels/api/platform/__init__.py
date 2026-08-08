"""
Платформенная консоль: владельческий уровень.

Работает на базовом домене под PlatformAuth (scope: platform). Все изменяющие
действия пишутся в AuditLog. Создание отеля — через единую точку
apps/hotels/services/provisioning.

Порядок подключения повторяет порядок объявления до переезда: Django резолвит
URL по порядку регистрации.
"""

from ninja import Router

from .auth import router as auth_router
from .fleet import router as fleet_router
from .hotels import router as hotels_router
from .nodes import router as nodes_router
from .overview import router as overview_router
from .tariffs import router as tariffs_router
from .team import router as team_router
from .templates import router as templates_router

# Тег НЕ дублируем: его несут файлы-ресурсы. Тег и на родителе, и на
# ребёнке ninja складывает — в схеме получается ["platform", "platform"].
router = Router()
router.add_router("", auth_router)
router.add_router("", overview_router)
router.add_router("", fleet_router)
router.add_router("", hotels_router)
router.add_router("", templates_router)
router.add_router("", tariffs_router)
router.add_router("", nodes_router)
router.add_router("", team_router)

__all__ = ["router"]
