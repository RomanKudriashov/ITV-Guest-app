"""
Витрина каталога для гостя.

Один эндпоинт на все типы предложений — контракт docs/guest-api-contract.md.
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.accounts.auth import GuestAuth
from apps.catalog.offerings import OfferingType
from apps.catalog.schemas.guest import MenuOut
from apps.catalog.services.menu import MenuOptions, build_menu
from apps.core.context import current_language

router = Router(tags=["guest"])
guest_auth = GuestAuth()


@router.get(
    "/catalog",
    response=MenuOut,
    auth=guest_auth,
    summary="Каталог любого типа: еда или заявки-услуги",
)
def get_catalog(
    request: HttpRequest,
    type: str = OfferingType.PRODUCT,
    include_unavailable: bool = True,
    point: str | None = None,
):
    """
    Один эндпоинт на все типы предложений — различается только тело позиции.
    Заводить «/services» рядом с «/menu» значило бы удваивать всё, что
    появится дальше: фильтры, локализацию, расписания.

    `point` сужает каталог до одного заведения (кода точки исполнения) — это
    третий уровень витрины при нескольких ресторанах. Без параметра — весь
    каталог типа, как раньше.
    """
    return build_menu(
        MenuOptions(
            language=current_language(),
            include_unavailable=include_unavailable,
            offering_type=type,
            point_code=point,
        ),
        hotel=request.hotel,
    )


# Псевдонима «/menu» больше нет — и это не уборка ради уборки.
#
# Он принимал ровно `include_unavailable`, а всё остальное молча проглатывал:
# запрос «/menu?venue=kitchen» отдавал ВЕСЬ каталог отеля и выглядел рабочим.
# На это уже потрачено время дважды: сначала при разборе карточки позиции,
# потом при съёмке кадров. Каталог теперь один — «/catalog» с явными `type` и
# `point`, а неизвестный адрес честно отвечает 404 вместо правдоподобного
# ответа не на тот вопрос.
