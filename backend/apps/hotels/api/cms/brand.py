"""
CMS: бренд-настройки. Контракт — docs/brand-api-contract.md.

Вьюхи тонкие: вся валидация и merge — в apps/hotels/services/brand_services.py.
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.accounts.services.roles import require_hotel_admin

from apps.hotels.brand_library import ABSTRACTIONS, FONTS, list_presets
from apps.hotels.schemas.cms import ApplyPresetIn, BrandOut, BrandPatch
from apps.hotels.services import brand_services as svc
from apps.hotels.services.hotel import current_hotel
from apps.core.context import current_language

router = Router(tags=["cms:brand"])


@router.get("/brand", response=BrandOut, summary="Текущая тема отеля")
def get_brand(request: HttpRequest):
    # ОФОРМЛЕНИЕ ОТЕЛЯ ЧИТАЕТ ТОЛЬКО АДМИН. Правка темы давно требовала прав
    # администратора, а чтение отдавалось любому управляющему — при том, что
    # экран «Бренд» ему не показан вовсе. Тема отеля не нужна для работы
    # заведения ни в одном сценарии.
    require_hotel_admin()
    return svc.serialize_brand(svc.get_or_create_brand())


@router.patch("/brand", response=BrandOut, summary="Изменить токены (deep-merge)")
def patch_brand(request: HttpRequest, payload: BrandPatch):
    theme = svc.update_brand(payload.tokens or {})
    return svc.serialize_brand(theme)


@router.put("/brand", response=BrandOut, summary="Заменить набор токенов целиком")
def put_brand(request: HttpRequest, payload: BrandPatch):
    """
    PATCH правит, PUT заменяет. Разница принципиальна для ВОЗВРАТА состояния:
    deep-merge не умеет убрать ключ, а значит не умеет откатить.
    """
    theme = svc.replace_brand(payload.tokens or {})
    return svc.serialize_brand(theme)


@router.get("/brand/preview", summary="Показ витрины: те же данные, что увидит гость")
def brand_preview(
    request: HttpRequest,
    screen: str = "home",
    group: str = "",
    point: str = "",
    type: str = "product",
    item_id: str = "",
    room: str = "",
):
    """
    Данные ОДНОГО экрана показа, в той же форме, в какой их получает гость.

    ОБЪЯВЛЕНА ВЫШЕ `/brand` с параметрами и ниже самого `/brand`: путь
    статический, но соседи по файлу динамических сегментов не имеют, так что
    порядок здесь про читаемость, а не про маршрутизацию.

    Гостевой сессии не заводит — см. `apps/hotels/services/brand_preview.py`.
    """
    from apps.hotels.services.brand_preview import preview_payload

    return preview_payload(
        current_hotel(),
        screen=screen,
        language=current_language(),
        group=group,
        point=point,
        offering_type=type,
        item_id=item_id,
        room_number=room,
    )


@router.get("/brand/presets", summary="Библиотека пресетов")
def presets(request: HttpRequest):
    # Библиотека оформления — часть админского экрана бренда.
    require_hotel_admin()
    return {"presets": list_presets()}


@router.post("/brand/apply-preset", response=BrandOut, summary="Применить пресет целиком")
def apply_preset(request: HttpRequest, payload: ApplyPresetIn):
    theme = svc.apply_preset(payload.preset)
    return svc.serialize_brand(theme)


@router.get("/brand/fonts", summary="Курируемый список шрифтов")
def fonts(request: HttpRequest):
    # Библиотека оформления — часть админского экрана бренда.
    require_hotel_admin()
    return {"fonts": FONTS}


@router.get("/brand/abstractions", summary="Библиотека фонов-абстракций")
def abstractions(request: HttpRequest):
    # Библиотека оформления — часть админского экрана бренда.
    require_hotel_admin()
    return {"abstractions": ABSTRACTIONS}


@router.get("/brand/look", summary="Своё оформление или пресет платформы")
def cms_brand_look(request: HttpRequest):
    """
    Отелю — тем же словом, что и платформе: «своё оформление», а не
    «расхождение». Экран, предлагающий починить неполоманное, приучает
    нажимать «ок» не глядя.
    """
    from apps.hotels.services import brand_inheritance, hotel_settings as svc

    # Результат не нужен — нужна ПРОВЕРКА ПРАВ внутри: `hotel_for_settings()`
    # зовёт `require_hotel_admin()`. Вызов без присваивания читается как
    # забытая строка, поэтому сказано прямо.
    svc.hotel_for_settings()
    return brand_inheritance.look_of_current_hotel()
