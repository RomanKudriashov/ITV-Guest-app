"""
РЕДАКТОР ПЛАНА: работа, а не маршрут.

Тела лежали во вьюхах CMS, и когда конфигурация переехала в платформенную
консоль, оказалось, что переносить нечего — кроме кода вьюхи. Поэтому работа
переехала СЮДА, а обе стороны её зовут: CMS отеля (пока раздел там ещё виден)
и консоль платформы.

Отель приходит ПАРАМЕТРОМ, а не берётся из контекста запроса: у платформенной
ручки «текущего отеля» нет вовсе — он назван в адресе.

Журнал пишет ВЫЗЫВАЮЩИЙ. У CMS это сотрудник отеля, у консоли — наш оператор,
и запись обязана называть разных людей разными акторами: ради этого разделения
переезд и делался.
"""

from __future__ import annotations

from apps.core.context import tenant_context
from apps.core.errors import ValidationError
from apps.grms.services import builder, publishing

# Кадр плана — фотография или рендер комнаты: 12 МБ хватает даже для снимка с
# телефона без сжатия, а больше означает, что грузят не то.
MAX_PLAN_BYTES = 12 * 1024 * 1024


def payload(hotel, code: str) -> dict:
    """
    Всё, что нужно редактору, одним ответом: черновик разметки, состояние
    кадров и СПИСОК элементов для привязки.

    Список приезжает с сервера, потому что привязка — это выбор из
    опубликованного конфига, а не ввод кода руками: набранный руками
    `controlId` живёт до первого переименования элемента.
    """
    from apps.grms.services import plan as plan_geometry

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


def save_geometry(hotel, code: str, payload_in) -> dict:
    """
    Разметка сохраняется В ЧЕРНОВИК типа, а не в опубликованную версию.

    Гость видит копию, попавшую в снимок при публикации: правка разметки не
    уезжает в номер мимо публикации, а откат конфигурации возвращает геометрию
    своей версии.
    """
    from apps.grms.services import plan as plan_geometry

    with tenant_context(hotel):
        room_type = builder._type(code)

        def apply(plan: dict) -> None:
            plan.update(
                {
                    "aspect": payload_in.aspect or plan.get("aspect"),
                    "zones": payload_in.zones,
                    "windows": payload_in.windows,
                    "points": payload_in.points,
                    "mirrored": payload_in.mirrored,
                    "extinguish_sources": payload_in.extinguish_sources,
                }
            )

        # Под блокировкой: рядом может идти фоновый расчёт ночного кадра, и он
        # пишет в ту же колонку. См. `plan.edit`.
        plan_geometry.edit(room_type, apply)

        # Журнал разметки пишет ВЫЗЫВАЮЩИЙ: у CMS это сотрудник отеля, у
        # платформенной консоли — наш оператор, и запись обязана называть
        # разных людей разными акторами.
    return payload(hotel, code)


def store_frames(hotel, code: str, *, lit, off=None) -> dict:
    """
    Один светлый кадр — ночной считается на сервере фоновой задачей.
    Пара своих кадров — принимается ТОЛЬКО при совпадении.

    Проверка пары не перестраховка: два отдельно сгенерированных кадра того же
    номера разошлись по габаритам примерно на 21%, и мебель на границе
    включённой зоны двоилась. Не совпало — честно отвечаем причиной и
    предлагаем посчитать ночной кадр из светлого; тогда совмещение гарантировано
    построением, а не удачей.
    """
    from apps.grms.models import RoomType
    from apps.grms.services import pair
    from apps.grms.services import plan as plan_geometry
    from apps.grms.tasks import bake_room_plan_night
    from apps.media.models import MediaAsset
    from apps.media.services import upload_asset

    lit_raw = lit.read()
    if len(lit_raw) > MAX_PLAN_BYTES:
        raise ValidationError("Кадр больше 12 МБ", field="lit")

    with tenant_context(hotel):
        level = builder._type(code).plan_level

    # ПЛАШКИ: у типа плана нет вовсе, и кадр ему не к чему приложить.
    if level == RoomType.PlanLevel.TILES:
        raise ValidationError(
            "У этого типа номера плана нет: экран работает списком зон. "
            "Чтобы загрузить кадр, поднимите уровень плана.",
            field="lit",
            code="plan_level_tiles",
        )

    verdict = None
    off_raw = off.read() if off is not None else None

    # ПРОСТОЙ ПЛАН: ВТОРОЙ КАДР НЕ ПРИНИМАЕТСЯ, И ЭТО ОТКАЗ СЕРВЕРА.
    #
    # Спрятать поле на экране мало: скрытый, но живой контрол — это то, что мы
    # уже ловили, когда экран не показывал, а запрос проходил. У простого плана
    # ночного кадра нет по устройству вида, и принятый «на всякий случай»
    # второй кадр означал бы тип, который выглядит простым, а в снимке несёт
    # пару, — то есть расхождение между проданным и опубликованным.
    if off_raw is not None and level != RoomType.PlanLevel.FULL:
        raise ValidationError(
            "У простого плана ночного кадра нет: комната показывается как есть, "
            "включённые зоны заливаются. Второй кадр нужен только полному плану.",
            field="off",
            code="night_frame_not_allowed",
        )

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

    # СЧЁТ НОЧНОГО КАДРА — ТОЛЬКО У ПОЛНОГО ПЛАНА.
    #
    # У простого он не нужен и вреден: задача положила бы в конфигурацию второй
    # кадр, которого этот вид не показывает, а редактор ждал бы его до
    # истечения срока. Считаем фоном — расчёт идёт секунды, а размечать план
    # можно уже сейчас.
    baking = off_raw is None and level == RoomType.PlanLevel.FULL
    if baking:
        bake_room_plan_night.delay(
            hotel_id=str(hotel.pk), room_type_code=code, lit_asset_id=str(lit_asset.pk)
        )

    return {
        "ok": True,
        "pair": verdict.as_dict if verdict else None,
        # `none` — ночного кадра не будет и ждать его не надо. Экран простого
        # плана по этому полю и понимает, что строку про ночной кадр показывать
        # нечего.
        "night": "baking" if baking else ("uploaded" if off_raw is not None else "none"),
        "plan": payload(hotel, code),
    }


def copy_geometry(hotel, code: str, payload_in) -> dict:
    """
    Планировки в отеле повторяются, и размечать одно и то же второй раз —
    работа без содержания. Копируется ГЕОМЕТРИЯ, но не кадры: у другого типа
    свой рендер, и подставлять его сюда значит показать гостю чужую комнату.

    Привязки зон переносятся как есть и проверяются при публикации: если у
    этого типа нет такого элемента, публикация не пройдёт и скажет, чего не
    хватает.
    """
    from apps.grms.services import plan as plan_geometry

    with tenant_context(hotel):
        source = builder._type(payload_in.source)
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
    return payload(hotel, code)
