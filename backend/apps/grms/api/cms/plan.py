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
from apps.grms.services import builder, publishing
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
    """
    Всё, что нужно редактору, одним ответом: черновик разметки, состояние
    кадров и СПИСОК элементов для привязки.

    Список приезжает с сервера, потому что привязка — это выбор из
    опубликованного конфига, а не ввод кода руками: набранный руками
    `controlId` живёт до первого переименования элемента.
    """
    from apps.grms.services import plan as plan_geometry

    hotel = hotel_with_module()
    with tenant_context(hotel):
        room_type = builder._type(code)
        draft = dict(room_type.plan or {})

        frame = plan_geometry.frame_payload

        status = publishing.current(hotel, code)
        controls = [
            {
                "controlId": control["controlId"],
                "title": (control.get("title") or {}).get("ru") or control["controlId"],
                "kind": control.get("kind") or "",
                "zone": zone.get("code") or "",
            }
            for zone in ((status.payload if status else {}) or {}).get("zones", [])
            for control in zone.get("controls", [])
        ]

    return {
        "geometry": {
            "aspect": draft.get("aspect"),
            "zones": draft.get("zones") or [],
            "windows": draft.get("windows") or [],
            "points": draft.get("points") or [],
            "mirrored": bool(draft.get("mirrored")),
            # По умолчанию гасим: на нормальном рендере это то, ради чего
            # расчёт и делается. Отсутствие ключа — старый план, а не отказ.
            "extinguish_sources": bool(draft.get("extinguish_sources", True)),
        },
        "frames": {
            "lit": frame(draft.get("asset_id")),
            "off": frame(draft.get("asset_off_id")),
            "off_source": draft.get("asset_off_source") or "",
        },
        # Привязывать можно только к ОПУБЛИКОВАННЫМ элементам: план едет гостю
        # вместе с опубликованной версией, и ссылка на черновой элемент
        # означала бы точку управления, которой у гостя нет.
        "controls": controls,
        "published": bool(status),
    }


@router.put("/grms/types/{code}/plan", summary="Сохранить разметку плана")
def put_plan(request: HttpRequest, code: str, payload: PlanGeometryIn):
    """
    Разметка сохраняется В ЧЕРНОВИК типа, а не в опубликованную версию.

    Гость видит копию, попавшую в снимок при публикации: правка разметки не
    уезжает в номер мимо публикации, а откат конфигурации возвращает геометрию
    своей версии.
    """
    from apps.grms.services import plan as plan_geometry

    hotel = hotel_with_module()
    with tenant_context(hotel):
        room_type = builder._type(code)

        def apply(plan: dict) -> None:
            plan.update(
                {
                    "aspect": payload.aspect or plan.get("aspect"),
                    "zones": payload.zones,
                    "windows": payload.windows,
                    "points": payload.points,
                    "mirrored": payload.mirrored,
                    "extinguish_sources": payload.extinguish_sources,
                }
            )

        # Под блокировкой: рядом может идти фоновый расчёт ночного кадра, и он
        # пишет в ту же колонку. См. `plan.edit`.
        plan_geometry.edit(room_type, apply)

        AuditLog.record(
            "grms.plan_saved",
            actor_type=AuditLog.ActorType.STAFF,
            object_type="grms.room_type",
            object_id=room_type.pk,
            payload={"type": code, "zones": len(payload.zones), "windows": len(payload.windows)},
            hotel_id=hotel.pk,
        )
    return get_plan(request, code)


@router.post("/grms/types/{code}/plan/frames", summary="Загрузить кадр (или пару) плана")
def upload_plan_frames(
    request: HttpRequest,
    code: str,
    lit: UploadedFile = File(...),
    off: UploadedFile = File(None),
):
    """
    Один светлый кадр — ночной считается на сервере фоновой задачей.
    Пара своих кадров — принимается ТОЛЬКО при совпадении.

    Проверка пары не перестраховка: два отдельно сгенерированных кадра того же
    номера разошлись по габаритам примерно на 21%, и мебель на границе
    включённой зоны двоилась. Не совпало — честно отвечаем причиной и
    предлагаем посчитать ночной кадр из светлого; тогда совмещение гарантировано
    построением, а не удачей.
    """
    from apps.grms.services import pair
    from apps.grms.services import plan as plan_geometry
    from apps.grms.tasks import bake_room_plan_night
    from apps.media.models import MediaAsset
    from apps.media.services import upload_asset

    hotel = hotel_with_module()
    lit_raw = lit.read()
    if len(lit_raw) > MAX_PLAN_BYTES:
        raise ValidationError("Кадр больше 12 МБ", field="lit")

    verdict = None
    off_raw = off.read() if off is not None else None
    if off_raw is not None:
        if len(off_raw) > MAX_PLAN_BYTES:
            raise ValidationError("Кадр больше 12 МБ", field="off")
        verdict = pair.compare(lit_raw, off_raw)
        if not verdict.ok:
            # НЕ сохраняем ничего: половина пары в конфигурации хуже, чем её
            # отсутствие — план собрался бы с кадром, которому не место.
            return {
                "ok": False,
                "pair": verdict.as_dict,
                "hint": "computed_night_frame",
            }

    with tenant_context(hotel):
        room_type = builder._type(code)
        lit_asset = upload_asset(
            content=lit_raw,
            filename=lit.name or "plan.png",
            kind=MediaAsset.Kind.ROOM_PLAN,
            content_type=lit.content_type or "image/png",
            alt={"ru": "План номера, свет включён"},
        )
        off_asset = None
        if off_raw is not None:
            off_asset = upload_asset(
                content=off_raw,
                filename=off.name or "plan-off.png",
                kind=MediaAsset.Kind.ROOM_PLAN,
                content_type=off.content_type or "image/png",
                alt={"ru": "План номера, свет выключен"},
            )

        # Пропорция берётся ИЗ ФАЙЛА: спрашивать её у администратора значит
        # спрашивать то, что и так известно, и однажды получить неверный ответ.
        aspect = None
        try:
            from PIL import Image
            import io as _io

            with Image.open(_io.BytesIO(lit_raw)) as image:
                aspect = round(image.width / image.height, 4)
        except Exception:  # noqa: BLE001 — не смогли прочитать, спросим позже
            aspect = None

        def apply(plan: dict) -> None:
            plan["asset_id"] = str(lit_asset.pk)
            plan.pop("asset_off_id", None)
            plan["asset_off_source"] = ""
            if off_asset is not None:
                plan["asset_off_id"] = str(off_asset.pk)
                plan["asset_off_source"] = "uploaded"
            if aspect:
                plan["aspect"] = aspect

        # Разметка при этом СОХРАНЯЕТСЯ: кадр меняют и на размеченном типе,
        # а координаты в процентах переживают смену рендера. См. `plan.edit`.
        plan_geometry.edit(room_type, apply)

    if off_raw is None:
        # Считаем ночной кадр фоном: расчёт идёт секунды, а размечать план
        # можно уже сейчас.
        bake_room_plan_night.delay(
            hotel_id=str(hotel.pk), room_type_code=code, lit_asset_id=str(lit_asset.pk)
        )

    return {
        "ok": True,
        "pair": verdict.as_dict if verdict else None,
        "night": "baking" if off_raw is None else "uploaded",
        "plan": get_plan(request, code),
    }




@router.post("/grms/types/{code}/plan/copy", summary="Скопировать разметку с другого типа")
def copy_plan(request: HttpRequest, code: str, payload: PlanCopyIn):
    """
    Планировки в отеле повторяются, и размечать одно и то же второй раз —
    работа без содержания. Копируется ГЕОМЕТРИЯ, но не кадры: у другого типа
    свой рендер, и подставлять его сюда значит показать гостю чужую комнату.

    Привязки зон переносятся как есть и проверяются при публикации: если у
    этого типа нет такого элемента, публикация не пройдёт и скажет, чего не
    хватает.
    """
    from apps.grms.services import plan as plan_geometry

    hotel = hotel_with_module()
    with tenant_context(hotel):
        source = builder._type(payload.source)
        target = builder._type(code)
        if source.pk == target.pk:
            raise ValidationError("Копировать не с чего: это тот же тип", field="source")
        donor = dict(source.plan or {})
        if not donor.get("zones"):
            raise ValidationError("У выбранного типа нет разметки", field="source")

        def apply(plan: dict) -> None:
            plan.update(
                {
                    "zones": donor.get("zones") or [],
                    "windows": donor.get("windows") or [],
                    "points": donor.get("points") or [],
                    "mirrored": bool(donor.get("mirrored")),
                }
            )

        # Кадры остаются свои — копируется РАЗМЕТКА. Под блокировкой: рядом
        # может считаться ночной кадр этого же типа. См. `plan.edit`.
        plan_geometry.edit(target, apply)
    return get_plan(request, code)
