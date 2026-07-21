from ninja import Router

from .brand import router as brand_router
from .catalog import router as catalog_router
from .common import router as common_router
from .notifications import router as notifications_router

router = Router()
router.add_router("", common_router)
router.add_router("", catalog_router)
router.add_router("", notifications_router)
router.add_router("", brand_router)

__all__ = ["router"]
