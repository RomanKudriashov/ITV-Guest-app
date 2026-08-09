"""
План-двойник номера: геометрия в конфиге, рендеры — в медиапайплайне.

Кадров ДВА, и они попиксельно совмещены: нижний ночной виден всегда, верхний
светлый показывается только там, где свет подтверждённо включён. Ночной
СЧИТАЕТСЯ из светлого (docs/design/grms-concept/bake_dark_plate.py), поэтому
совмещён по построению — нарисованный отдельно тёмный рендер расходился с
светлым по габаритам примерно на 21% и давал двойную мебель на границе зоны.

Ночного кадра может не быть: тогда плита работает по-старому — один кадр и
затемняющая маска по выключенной зоне. Это хуже на вид, но честно, и новый тип
номера подключается без ночного рендера, а не с битой картинкой.

Два правила, из которых следует весь модуль.

ГЕОМЕТРИЯ ЖИВЁТ В КОНФИГУРАЦИИ ТИПА И ТОЛЬКО В ПРОЦЕНТАХ. Не в пикселях и не
в коде компонента: новый тип номера с другим рендером обязан подключаться без
правки фронта, а проценты — единственное, что переживает смену размера кадра и
вариант, нарезанный медиапайплайном.

НА ПЛАНЕ НЕТ ТОЧКИ, ЗА КОТОРОЙ НЕТ ЭЛЕМЕНТА. Зона, окно и точка воздуха
ссылаются на `controlId`; ссылку, которой не соответствует опубликованный
элемент, `normalize` выбрасывает. Иначе гость получил бы кликабельную комнату,
за которой нет ни канала, ни подтверждения, — то же самое обещание без
исполнителя, из-за которого непривязанный элемент не попадает в снимок.

URL картинки собирает СЕРВЕР (`for_guest`), а не фронт: адрес объекта в MinIO
зависит от варианта, готовности нарезки и настроек стенда, и склеенный на
фронте он ломается ровно тогда, когда его некому чинить.
"""

from __future__ import annotations

ORIENTATIONS = ("horizontal", "vertical")

# Куда дует точка воздуха. Свойство РАЗМЕТКИ, а не кода: фанкойл висит на
# стене, и в какую сторону от неё идёт струя, знает тот, кто размечал план, —
# у зеркальной планировки та же стена смотрит в другую сторону.
#
# Точкам света поле безразлично: чем окажется точка — лампой или воздухом, —
# решает элемент, на который она ссылается.
POINT_DIRECTIONS = ("up", "down", "left", "right")
DEFAULT_POINT_DIRECTION = "down"

# Вариант рендера для плиты. `card` (600px) на планшете и десктопе заметно
# мылит стены, `full` — 1200px — это тот же кадр, ужатый вдвое от исходных
# 1586, и разметка на него садится один в один: координаты в процентах.
PLATE_VARIANT = "full"


def edit(room_type, mutate) -> dict:
    """
    Изменить план типа ПОД БЛОКИРОВКОЙ СТРОКИ и вернуть получившийся план.

    План — одна колонка JSON, а пишут в неё трое: сохранение разметки, загрузка
    кадров и фоновый расчёт ночного кадра. Каждый читал план, менял своё поле и
    писал обратно целиком, и «прочитал — посчитал — записал» у двоих сразу
    означало, что поздний писатель затирает чужое: администратор обводит зону
    ровно в те секунды, пока фоном считается ночной кадр, — это не редкий
    случай, а ОБЫЧНЫЙ ход работы, потому что размечать план он начинает сразу
    после загрузки кадра.

    Поэтому чтение и запись идут одной транзакцией с `select_for_update`:
    каждый писатель видит чужие правки, а не свою устаревшую копию.
    """
    from django.db import transaction

    from apps.grms.models import RoomType

    with transaction.atomic():
        locked = RoomType.objects.select_for_update().get(pk=room_type.pk)
        plan = dict(locked.plan or {})
        mutate(plan)
        locked.plan = plan
        locked.save(update_fields=["plan", "updated_at"])
    room_type.plan = plan
    return plan


def _rect(raw: object) -> dict | None:
    """Прямоугольник в процентах. Отрицательный x/y допустим намеренно."""
    if not isinstance(raw, dict):
        return None
    try:
        rect = {key: round(float(raw[key]), 3) for key in ("x", "y", "w", "h")}
    except (KeyError, TypeError, ValueError):
        return None
    if rect["w"] <= 0 or rect["h"] <= 0:
        return None
    return rect


def _point(raw: object) -> tuple[float, float] | None:
    if not isinstance(raw, dict):
        return None
    try:
        return round(float(raw["x"]), 3), round(float(raw["y"]), 3)
    except (KeyError, TypeError, ValueError):
        return None


def normalize(raw: object, *, control_ids: set[str]) -> dict:
    """
    Черновик геометрии → форма, которая уедет в снимок.

    Возвращает `{}`, если плана нет или от него ничего не осталось: ни ассета,
    ни одной живой зоны. Пустой план — это НЕ ошибка и не заглушка, а штатное
    «у типа плана нет», при котором экран работает списком контролов.

    Маска и хит-зона обязаны быть обе: зона без маски не умеет показывать свет,
    зона без хита — принимать нажатие, и половинчатая зона на плане хуже, чем
    её отсутствие.
    """
    if not isinstance(raw, dict):
        return {}
    asset_id = str(raw.get("asset_id") or "")
    if not asset_id:
        return {}

    zones = []
    for zone in raw.get("zones") or []:
        if not isinstance(zone, dict):
            continue
        control_id = str(zone.get("controlId") or "")
        if control_id not in control_ids:
            continue
        hit, mask = _rect(zone.get("hit")), _rect(zone.get("mask"))
        if hit is None or mask is None:
            continue
        zones.append(
            {
                "code": str(zone.get("code") or ""),
                "controlId": control_id,
                "hit": hit,
                "mask": mask,
            }
        )
    if not zones:
        # Рендер без единой управляемой зоны — картинка ради картинки.
        return {}

    windows = []
    for window in raw.get("windows") or []:
        if not isinstance(window, dict):
            continue
        curtain_id = str(window.get("curtainId") or "")
        if curtain_id not in control_ids:
            continue
        rect = _rect(window)
        if rect is None:
            continue
        blackout_id = str(window.get("blackoutId") or "")
        orientation = window.get("orientation")
        windows.append(
            {
                "code": str(window.get("code") or ""),
                **rect,
                "orientation": orientation if orientation in ORIENTATIONS else "horizontal",
                "curtainId": curtain_id,
                # Блэкаут — отдельный слой на том же окне и отдельный элемент.
                # Его может не быть, и это не мешает окну существовать.
                "blackoutId": blackout_id if blackout_id in control_ids else "",
            }
        )

    points = []
    for point in raw.get("points") or []:
        if not isinstance(point, dict):
            continue
        control_id = str(point.get("controlId") or "")
        if control_id not in control_ids:
            continue
        coords = _point(point)
        if coords is None:
            continue
        direction = str(point.get("dir") or "")
        points.append(
            {
                "controlId": control_id,
                "x": coords[0],
                "y": coords[1],
                "dir": direction if direction in POINT_DIRECTIONS else DEFAULT_POINT_DIRECTION,
            }
        )

    aspect = None
    try:
        value = float(raw.get("aspect") or 0)
        aspect = round(value, 4) if value > 0 else None
    except (TypeError, ValueError):
        aspect = None

    return {
        "asset_id": asset_id,
        # Ночной кадр. Пусто — плита падает назад на затемняющую маску: у типа
        # может не быть посчитанного кадра, и это не повод не показывать план.
        "asset_off_id": str(raw.get("asset_off_id") or ""),
        "aspect": aspect,
        # Зеркальная планировка: номера по разные стороны коридора — одна и та
        # же комната, отражённая. Отражается ПЛИТА ЦЕЛИКОМ (кадры вместе с
        # геометрией), а не координаты по отдельности: раздельное отражение
        # разошлось бы при первой же правке разметки.
        "mirrored": bool(raw.get("mirrored")),
        "zones": zones,
        "windows": windows,
        "points": points,
    }


def dangling(raw: object, *, control_ids: set[str]) -> list[dict]:
    """
    Ссылки разметки, за которыми нет опубликованного элемента.

    Такие ссылки НЕ выбрасываются молча при публикации, а блокируют её. Молчание
    здесь дороже: администратор разметил зону, переименовал или снял элемент — и
    зона на плане перестала быть кликабельной, а он об этом не узнал. Ошибку
    нашли бы в номере, причём не он.
    """
    if not isinstance(raw, dict):
        return []

    broken: list[dict] = []
    for zone in raw.get("zones") or []:
        if not isinstance(zone, dict):
            continue
        control_id = str(zone.get("controlId") or "")
        if not control_id:
            broken.append({"kind": "zone", "code": str(zone.get("code") or ""), "ref": ""})
        elif control_id not in control_ids:
            broken.append({"kind": "zone", "code": str(zone.get("code") or ""), "ref": control_id})

    for window in raw.get("windows") or []:
        if not isinstance(window, dict):
            continue
        for field_name in ("curtainId", "blackoutId"):
            ref = str(window.get(field_name) or "")
            if ref and ref not in control_ids:
                broken.append({"kind": "window", "code": str(window.get("code") or ""), "ref": ref})

    for point in raw.get("points") or []:
        if not isinstance(point, dict):
            continue
        ref = str(point.get("controlId") or "")
        if ref and ref not in control_ids:
            broken.append({"kind": "point", "code": "", "ref": ref})

    return broken


def for_guest(plan: object) -> dict:
    """
    Снимок → то, что видит гость: готовый URL, пропорция и геометрия.

    Ассет не готов (нарезка ещё идёт или упала) — плана НЕТ вовсе. Отдать
    геометрию без картинки значит показать гостю пустую рамку с кнопками
    поверх ничего; отдать ссылку на ненарезанный объект — битую картинку.
    Экран в этом случае работает списком, как у типа без плана.

    Вызывать в контексте тенанта: медиа закрыто RLS.
    """
    if not isinstance(plan, dict) or not plan.get("asset_id"):
        return {}

    asset = _asset(plan.get("asset_id"))
    if asset is None:
        return {}
    image = asset.url(PLATE_VARIANT)
    if not image:
        return {}

    # Ночной кадр необязателен и на своих условиях: не готов — плита обходится
    # маской, а не ждёт его и не показывает битую картинку.
    off_asset = _asset(plan.get("asset_off_id"))
    image_off = off_asset.url(PLATE_VARIANT) if off_asset is not None else ""

    aspect = plan.get("aspect")
    if not aspect and asset.width and asset.height:
        # Пропорция нужна, чтобы сверстать плиту ДО загрузки картинки: без неё
        # экран прыгает на высоту кадра в момент, когда гость уже читает список.
        aspect = round(asset.width / asset.height, 4)

    return {
        # Технического id ассета гостю не отдаём: ему принадлежит картинка, а
        # не запись о ней.
        "image": image,
        "image_off": image_off,
        "aspect": aspect or None,
        "mirrored": bool(plan.get("mirrored")),
        "zones": plan.get("zones") or [],
        "windows": plan.get("windows") or [],
        "points": plan.get("points") or [],
    }


def _asset(asset_id: object):
    """Ассет по id из конфигурации. Мусор вместо UUID — не 500, а «нет ассета»."""
    if not asset_id:
        return None

    from django.core.exceptions import ValidationError as DjangoValidationError

    from apps.media.models import MediaAsset

    try:
        return MediaAsset.objects.filter(pk=asset_id).first()
    except (DjangoValidationError, TypeError, ValueError):
        return None
