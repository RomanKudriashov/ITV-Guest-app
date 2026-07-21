"""
CMS: бренд-настройки. Контракт — docs/brand-api-contract.md.

Вьюхи тонкие: вся валидация и merge — в apps/hotels/brand_services.py.
"""

from __future__ import annotations

from typing import Any

from django.http import HttpRequest
from ninja import Router, Schema

from apps.hotels import brand_services as svc
from apps.hotels.brand_library import ABSTRACTIONS, FONTS, list_presets

router = Router(tags=["cms:brand"])


class BrandOut(Schema):
    id: str
    name: str
    preset: str
    tokens: dict[str, Any]
    updated_at: str


class BrandPatch(Schema):
    tokens: dict[str, Any] = {}


class ApplyPresetIn(Schema):
    preset: str


@router.get("/brand", response=BrandOut, summary="Текущая тема отеля")
def get_brand(request: HttpRequest):
    return svc.serialize_brand(svc.get_or_create_brand())


@router.patch("/brand", response=BrandOut, summary="Изменить токены (deep-merge)")
def patch_brand(request: HttpRequest, payload: BrandPatch):
    theme = svc.update_brand(payload.tokens or {})
    return svc.serialize_brand(theme)


@router.get("/brand/presets", summary="Библиотека пресетов")
def presets(request: HttpRequest):
    return {"presets": list_presets()}


@router.post("/brand/apply-preset", response=BrandOut, summary="Применить пресет целиком")
def apply_preset(request: HttpRequest, payload: ApplyPresetIn):
    theme = svc.apply_preset(payload.preset)
    return svc.serialize_brand(theme)


@router.get("/brand/fonts", summary="Курируемый список шрифтов")
def fonts(request: HttpRequest):
    return {"fonts": FONTS}


@router.get("/brand/abstractions", summary="Библиотека фонов-абстракций")
def abstractions(request: HttpRequest):
    return {"abstractions": ABSTRACTIONS}
