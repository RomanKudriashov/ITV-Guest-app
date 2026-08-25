"""
ЧТО ОСТАЛОСЬ У ОТЕЛЯ.

Конструктор, импорт, план и публикация уехали в консоль платформы: это наша
пусконаладка, а не работа отеля. Здесь — только то, чем отель пользуется сам:
список типов (по нему выбирают, что проверять), состояние типа и прогон
элемента на живой комнате.

Ручки НЕ спрятаны, а сняты: спрятанный, но живой маршрут — это то, что мы уже
ловили, когда экран не показывал, а запрос проходил.

CMS: типы номеров, конструктор, проверка на живом номере, публикация.

Раздел закрыт МОДУЛЕМ `room_control`, а не только ролью: калитка
`services/access.hotel_with_module()` стоит на входе каждого эндпоинта, а не на
экране. Без неё отель без модуля дотянулся бы до оборудования запросом мимо
интерфейса.

Гостю здесь ничего не появляется: маршруты живут под `/api/v1/cms`, куда
гостевой токен не пускают в принципе (роутер закрыт `CmsAuth`).
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.grms.schemas.cms import CheckIn
from apps.grms.services import builder, roomcheck
from apps.grms.services.access import hotel_with_module

router = Router(tags=["cms-grms"])


# --- Типы и переменные ------------------------------------------------------


@router.get("/grms/types", summary="Типы номеров с переменными")
def list_types(request: HttpRequest):
    return {"types": builder.list_types_with_variables(hotel_with_module())}


@router.get("/grms/types/{code}/status", summary="Что опубликуется, а что скрыто")
def type_status(request: HttpRequest, code: str):
    return builder.type_status(hotel_with_module(), code)




# ПОДМЕНЫ УСТРОЙСТВА ЗДЕСЬ БОЛЬШЕ НЕТ.
#
# Она переехала в консоль вместе с конструктором — единственным экраном,
# который её и звал. Оставлять ручку без экрана было хуже всего: дверь открыта,
# ручки на ней нет, и «никто туда не ходит» держалось ровно до первого, кто
# посмотрел список адресов. Перенацелить комнату на другое устройство — это
# пусконаладка, то есть наша работа, а не любопытство администратора отеля.


# --- Проверка на живом номере -----------------------------------------------




@router.post("/grms/types/{code}/check", summary="Прогнать элемент на комнате")
def check(request: HttpRequest, code: str, payload: CheckIn):
    return roomcheck.check_element(
        hotel_with_module(), room_type_code=code, element_slug=payload.element_slug,
        room_number=payload.room_number, capability=payload.capability, value=payload.value,
    )
