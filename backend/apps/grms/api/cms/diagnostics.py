"""
CMS: диагностика инженера — журнал обмена и состояние связи (ТЗ §14.3, §6.8).

Раздел закрыт МОДУЛЕМ `room_control`, как и остальные эндпоинты управления
номером: калитка `hotel_with_module()` стоит на входе каждого, а не на экране.

Гостю сюда хода нет по построению: маршруты живут под `/api/v1/cms`, а этот
роутер закрыт `CmsAuth` — гостевой токен туда не пускают в принципе. Это тот
самый рубеж, из-за которого технические причины отказа можно показывать
подробно: они физически не могут доехать до гостевого экрана, у которого
остаётся одна нейтральная фраза (ТЗ §6, `services/guest.py`).
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router

from apps.grms.services.access import hotel_with_module

router = Router(tags=["cms-grms"])


@router.get("/grms/diagnostics", summary="Журнал обмена с iRidi: что уходило и что вернулось")
def diagnostics_journal(
    request: HttpRequest,
    room: str = "",
    element_kind: str = "",
    outcome: str = "",
    date_from: str = "",
    date_to: str = "",
    limit: int = 0,
):
    """
    Отдаёт ЗАПИСАННОЕ, а не пересказ: время, номер, элемент, устройство,
    команду и feedback, отправленное значение, сырой ответ, длительность и
    итоговый статус — ровно восемь полей ТЗ §14.3 плюс причина отказа.

    Своего обмена с оборудованием не устраивает: открытие экрана диагностики
    не должно стучаться в живой отель.
    """
    from apps.grms.services import diagnostics

    # ГЛУБИНА РЕШАЕТСЯ ЗДЕСЬ, а не экраном.
    #
    # Эта ручка — отельская: сырой ответ оборудования по ней не уходит. Тот же
    # журнал во всей полноте отдаёт платформенная ручка, и читает её инженер.
    result = diagnostics.journal(
        hotel_with_module(),
        room=room,
        element_kind=element_kind,
        outcome=outcome,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
    )
    return {
        **result,
        "rows": [diagnostics.for_hotel(row) for row in result.get("rows", [])],
        # Экран отеля по этому признаку знает, что журнал урезан, и не молчит
        # об этом: «где остальное» — законный вопрос, и ответ на него есть.
        "depth": "hotel",
    }


@router.get("/grms/diagnostics/link", summary="Связь по звеньям: коннектор, endpoint, чтение")
def diagnostics_link(request: HttpRequest):
    """
    Три звена ПОРОЗНЬ (ТЗ §14 «статусы отображаются отдельно»).

    Гостю на его экране всё это схлопывается в «временно недоступно» — здесь
    наоборот: инженеру нужно знать, на каком звене оборвалось, иначе он поедет
    на объект проверять коннектор, у которого недоступен endpoint.
    """
    from apps.grms.services import diagnostics

    return diagnostics.link_state(hotel_with_module())


@router.get("/grms/diagnostics/filters", summary="Значения фильтров журнала")
def diagnostics_filters(request: HttpRequest):
    """
    Виды элементов и исходы для выпадающих списков.

    Виды берутся из КАТАЛОГА, а не из журнала: список фильтров, собранный по
    уже случившемуся, не даёт отфильтровать по тому, что ни разу не сломалось,
    — а инженеру нужно именно убедиться, что там пусто.
    """
    from apps.grms.services import catalog, diagnostics

    hotel_with_module()
    return {
        "element_kinds": [
            {"code": code, "title": title} for code, title in catalog.ELEMENT_CHOICES
        ],
        "outcomes": diagnostics.outcomes(),
    }
