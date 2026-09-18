from ninja import Router

from apps.translate.api.cms import translate as cms_translate

cms_router = Router()
cms_router.add_router("", cms_translate.router)

__all__ = ["cms_router"]
