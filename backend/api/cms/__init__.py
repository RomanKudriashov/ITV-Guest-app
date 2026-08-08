from ninja import Router

from apps.catalog.api.router import cms_router as catalog_router
from apps.hotels.api.cms import router as hotel_settings_router

from .analytics import router as analytics_router
from .brand import router as brand_router
from .grms import router as grms_router
from .inclusions import router as inclusions_router
from .reviews import router as reviews_router
from .hotel_admin import router as hotel_admin_router
from .common import router as common_router
from .notifications import router as notifications_router

router = Router()
router.add_router("", common_router)
router.add_router("", catalog_router)
# Настройки уровня отеля (главная, поиск, витрина, коммерция) жили во вьюхе
# каталога, хотя правят Hotel.settings. Теперь они в apps/hotels.
router.add_router("", hotel_settings_router)
# Управление номером: раздел закрыт МОДУЛЕМ room_control на каждом эндпоинте.
router.add_router("", grms_router)
router.add_router("", inclusions_router)
router.add_router("", notifications_router)
router.add_router("", brand_router)
router.add_router("", hotel_admin_router)
router.add_router("", reviews_router)
router.add_router("", analytics_router)

__all__ = ["router"]
