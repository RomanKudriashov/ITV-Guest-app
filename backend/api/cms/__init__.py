from ninja import Router

from .catalog import router as catalog_router
from .common import router as common_router

router = Router()
router.add_router("", common_router)
router.add_router("", catalog_router)

__all__ = ["router"]
