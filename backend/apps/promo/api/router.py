from ninja import Router

from apps.promo.api.cms import banners as cms_banners
from apps.promo.api.guest import banner as guest_banner

cms_router = Router()
cms_router.add_router("", cms_banners.router)

guest_router = guest_banner.router

__all__ = ["cms_router", "guest_router"]
