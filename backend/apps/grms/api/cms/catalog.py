"""
CMS: фиксированный каталог элементов управления.

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

from apps.grms.services import catalog
from apps.grms.services.access import hotel_with_module

router = Router(tags=["cms-grms"])


# --- Каталог ----------------------------------------------------------------


@router.get("/grms/catalog", summary="Фиксированный каталог элементов")
def get_catalog(request: HttpRequest):
    """
    Каталог отдаётся С СЕРВЕРА, а не зашит во фронт: администратор не может
    добавить свой вид элемента, и список обязан совпадать с тем, что умеет
    исполнить адаптер.
    """
    hotel_with_module()
    return {
        "elements": [
            {
                "kind": kind.code,
                "title": kind.title_ru,
                "required": list(kind.required),
                "optional": list(kind.optional),
            }
            for kind in catalog.ELEMENTS.values()
        ],
        "capabilities": {
            code: {
                "value_kind": spec.value_kind,
                "requires_command": spec.requires_command,
                "requires_feedback": spec.requires_feedback,
                "readonly": spec.readonly,
            }
            for code, spec in catalog.CAPABILITIES.items()
        },
    }
