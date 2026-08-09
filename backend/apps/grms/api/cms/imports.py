"""
CMS: импорт Excel ПНР, сверка с живым iRidi, сохранение.

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

from apps.grms.schemas.cms import ConfirmIn, ReconcileIn
from apps.grms.services import builder, importer, reconcile
from apps.core.errors import ValidationError
from apps.grms.services.access import hotel_with_module

router = Router(tags=["cms-grms"])

MAX_IMPORT_BYTES = 5 * 1024 * 1024


# --- Импорт -----------------------------------------------------------------


@router.post("/grms/import/preview", summary="Разобрать Excel ПНР (без сохранения)")
def import_preview(request: HttpRequest, file: UploadedFile = File(...)):
    """
    Разбор БЕЗ записи. Администратор смотрит результат и предупреждения, при
    необходимости правит и только потом подтверждает (ТЗ §9).
    """
    hotel_with_module()
    if file.size and file.size > MAX_IMPORT_BYTES:
        raise ValidationError("Файл больше 5 МБ", field="file")
    try:
        preview = importer.parse(file.read())
    except importer.ImportError_ as exc:
        # Структура не та — показываем, а не додумываем.
        raise ValidationError(str(exc), field="file") from exc
    return preview.as_dict()




@router.post("/grms/import/reconcile", summary="Сверить разобранное с живым iRidi")
def import_reconcile(request: HttpRequest, payload: ReconcileIn):
    """
    Excel — не источник истины: на объекте у ТИП1 нашлось 12 групп света
    против 10 в файле. Сверка читает эталонную комнату каждого типа и
    подсвечивает расхождения.

    Коннектор офлайн — НЕ ошибка: вернётся `checked: false`, сохранение
    не блокируется.
    """
    hotel = hotel_with_module()
    preview = importer.ImportPreview.from_dict(payload.preview)
    reports = reconcile.reconcile_preview(hotel, preview)
    return {
        "reports": [report.as_dict() for report in reports],
        "checked": all(report.checked for report in reports),
    }




@router.post("/grms/import/confirm", summary="Сохранить подтверждённый импорт")
def import_confirm(request: HttpRequest, payload: ConfirmIn):
    hotel = hotel_with_module()
    preview = importer.ImportPreview.from_dict(payload.preview)
    if not preview.types:
        raise ValidationError("Нечего сохранять: в предпросмотре нет типов", field="preview")
    return builder.save_import(hotel, preview, replace=payload.replace)
