"""
CMS-эндпоинты отеля, нарезанные по РЕСУРСУ.

Порядок подключения повторяет порядок, в котором эндпоинты шли до переезда:
Django резолвит URL по порядку регистрации, и статический путь обязан быть
объявлен раньше параметризованного.
"""

from ninja import Router

from .bootstrap import router as bootstrap_router
from .brand import router as brand_router
from .locations import router as locations_router
from .rooms import router as rooms_router
from .schedules import router as schedules_router
from .services import router as services_router
from .settings_commerce import router as commerce_router
from .settings_home import router as home_router
from .settings_search import router as search_router
from .settings_showcase import router as showcase_router

router = Router()
router.add_router("", bootstrap_router)
router.add_router("", schedules_router)
router.add_router("", rooms_router)
router.add_router("", locations_router)
router.add_router("", services_router)
router.add_router("", brand_router)
router.add_router("", home_router)
router.add_router("", search_router)
router.add_router("", showcase_router)
router.add_router("", commerce_router)

__all__ = ["router"]
