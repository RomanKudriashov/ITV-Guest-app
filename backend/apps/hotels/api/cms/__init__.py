"""
CMS-эндпоинты отеля.

Сейчас здесь только настройки уровня отеля, переехавшие из вьюхи каталога:
главная, поиск, витрина, коммерция. Остальное приезжает партией 3.
"""

from ninja import Router

from .settings_commerce import router as commerce_router
from .settings_home import router as home_router
from .settings_search import router as search_router
from .settings_showcase import router as showcase_router

router = Router()
router.add_router("", home_router)
router.add_router("", search_router)
router.add_router("", showcase_router)
router.add_router("", commerce_router)

__all__ = ["router"]
