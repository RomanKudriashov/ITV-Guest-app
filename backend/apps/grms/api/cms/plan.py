"""
CMS: редактор плана номера — кадры, разметка, копирование.

Раздел закрыт МОДУЛЕМ `room_control`, а не только ролью: калитка
`services/access.hotel_with_module()` стоит на входе каждого эндпоинта, а не на
экране. Без неё отель без модуля дотянулся бы до оборудования запросом мимо
интерфейса.

Гостю здесь ничего не появляется: маршруты живут под `/api/v1/cms`, куда
гостевой токен не пускают в принципе (роутер закрыт `CmsAuth`).
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import File, Router
from ninja.files import UploadedFile

from apps.grms.schemas.cms import PlanCopyIn, PlanGeometryIn
from apps.core.context import tenant_context
from apps.grms.services import builder, plan_editor, publishing
from apps.core.errors import ValidationError
from apps.core.models import AuditLog
from apps.grms.services.access import hotel_with_module

router = Router(tags=["cms-grms"])

# Кадр плана — фотография или рендер комнаты: 12 МБ хватает даже для снимка
# с телефона без сжатия, а больше означает, что грузят не то.
MAX_PLAN_BYTES = 12 * 1024 * 1024


# --- Редактор плана ---------------------------------------------------------
#
# План — это ДВА КАДРА и геометрия в процентах. Кадры попадают сюда двумя
# путями, и оба обязательны: администратор либо приносит один светлый кадр и
# ночной считается на сервере, либо приносит свою пару — и тогда она
# ПРОВЕРЯЕТСЯ. Молча принять неподходящую пару нельзя: расхождение кадров
# всплывёт на объекте, когда номер уже сдан.




@router.get("/grms/types/{code}/plan", summary="План типа: кадры, разметка, что можно привязать")
def get_plan(request: HttpRequest, code: str):
    """Работа живёт в `services/plan_editor`: её зовёт и консоль платформы."""
    return plan_editor.payload(hotel_with_module(), code)


@router.put("/grms/types/{code}/plan", summary="Сохранить разметку плана")
def put_plan(request: HttpRequest, code: str, payload: PlanGeometryIn):
    hotel = hotel_with_module()
    result = plan_editor.save_geometry(hotel, code, payload)
    with tenant_context(hotel):
        AuditLog.record(
            "grms.plan_saved",
            actor_type=AuditLog.ActorType.STAFF,
            object_type="grms.room_type",
            object_id=None,
            payload={"type": code, "zones": len(payload.zones)},
            hotel_id=hotel.pk,
        )
    return result


@router.post("/grms/types/{code}/plan/frames", summary="Загрузить кадр (или пару) плана")
def upload_plan_frames(
    request: HttpRequest,
    code: str,
    lit: UploadedFile = File(...),
    off: UploadedFile = File(None),
):
    return plan_editor.store_frames(hotel_with_module(), code, lit=lit, off=off)


@router.post("/grms/types/{code}/plan/copy", summary="Скопировать разметку с другого типа")
def copy_plan(request: HttpRequest, code: str, payload: PlanCopyIn):
    return plan_editor.copy_geometry(hotel_with_module(), code, payload)
