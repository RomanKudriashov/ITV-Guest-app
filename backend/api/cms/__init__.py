from ninja import Router

from apps.catalog.api.router import cms_router as catalog_router
from apps.analytics.api.router import cms_router as analytics_router
from apps.notifications.api.router import cms_router as notifications_router
from apps.reviews.api.router import cms_router as reviews_router
from apps.grms.api.router import cms_router as grms_router
from apps.accounts.api.cms.staff import router as staff_router
from apps.hotels.api.cms import router as hotel_router
from apps.media.api.cms.media import router as media_router

from .inclusions import router as inclusions_router

router = Router()
router.add_router("", hotel_router)
router.add_router("", media_router)
router.add_router("", staff_router)
router.add_router("", catalog_router)
# Управление номером: раздел закрыт МОДУЛЕМ room_control на каждом эндпоинте.
router.add_router("", grms_router)
router.add_router("", inclusions_router)
router.add_router("", notifications_router)
router.add_router("", reviews_router)
router.add_router("", analytics_router)

__all__ = ["router"]
