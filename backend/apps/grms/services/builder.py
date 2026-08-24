"""
Конструктор гостевого интерфейса: типы, зоны, элементы, привязки.

Интерфейс собирается из ФИКСИРОВАННОГО каталога (`catalog.py`), а не из
произвольных кнопок и слайдеров (ТЗ §11). Администратор выбирает элемент,
кладёт его в зону, задаёт порядок и связывает с переменными из импорта —
и всё. Вид, иконку, логику и способ показа состояния он не меняет.

Главное правило публикации: **непривязанный элемент не публикуется**. Если у
объекта нет переменных под мастер-выключатель или отопление, элемент остаётся
скрытым, а не показывается гостю мёртвой кнопкой. Кнопка, которая ничего не
делает, хуже отсутствующей: гость жмёт её, ничего не происходит, и он идёт на
ресепшен.
"""

from __future__ import annotations

from dataclasses import dataclass

from apps.core.context import tenant_context
from apps.core.errors import NotFoundError, ValidationError
from apps.grms.services import catalog
from apps.grms.models import (
    Binding,
    ControlElement,
    RoomType,
    RoomTypeRoom,
    Variable,
    Zone,
)
from apps.hotels.models import Room


# --- Сохранение подтверждённого импорта -------------------------------------


def save_import(hotel, preview, *, replace: bool = False) -> dict:
    """
    Записать подтверждённый администратором предпросмотр.

    Импорт создаёт ТОЛЬКО технические переменные и типы. Ни одного элемента
    интерфейса: Excel — карта переменных, а не описание экрана (ТЗ §8).

    Комнаты привязываются лишь те, что реально заведены у отеля: файл ПНР
    перечисляет весь номерной фонд объекта, а в системе может быть заведена
    часть. Ненайденные возвращаются списком, а не создаются молча — иначе
    опечатка в файле родила бы номер-призрак.
    """
    created, skipped_rooms, conflicts = [], [], []

    with tenant_context(hotel):
        known_rooms = {room.number: room for room in Room.objects.all()}
        taken = {
            link.room_id: link.room_type_id
            for link in RoomTypeRoom.objects.select_related("room_type")
        }

        for parsed in preview.types:
            room_type, is_new = RoomType.objects.get_or_create(
                code=_slug(parsed.name),
                defaults={
                    "title": {"ru": parsed.name},
                    "device_name_template": parsed.device_name_template,
                },
            )
            if not is_new and replace:
                room_type.device_name_template = parsed.device_name_template
                room_type.save(update_fields=["device_name_template", "updated_at"])
                Variable.objects.filter(room_type=room_type).delete()

            for variable in parsed.variables:
                Variable.objects.update_or_create(
                    room_type=room_type,
                    key=variable.key,
                    defaults={
                        "command": variable.command,
                        "feedback": variable.feedback,
                        "value_kind": variable.value_kind,
                        "min_value": variable.min_value,
                        "max_value": variable.max_value,
                        "raw_range": variable.raw_range,
                        "description": variable.description,
                    },
                )

            for number in parsed.rooms:
                room = known_rooms.get(number)
                if room is None:
                    skipped_rooms.append(number)
                    continue
                existing = taken.get(room.pk)
                if existing and existing != room_type.pk:
                    # Комната уже отнесена к другому типу — молча переклеивать
                    # нельзя: оборудование у типов разное.
                    conflicts.append(number)
                    continue
                RoomTypeRoom.objects.update_or_create(
                    room=room,
                    defaults={
                        "room_type": room_type,
                        "is_reference": number == parsed.reference_room,
                    },
                )
                taken[room.pk] = room_type.pk

            created.append(room_type.code)

    return {
        "types": created,
        "rooms_not_in_system": sorted(set(skipped_rooms)),
        "rooms_in_conflict": sorted(set(conflicts)),
    }


# Кириллица в латиницу для кода типа. Без неё от русского имени не оставалось
# ничего: «ТИП1» из настоящего файла ПНР превращался в код «1», а имя без
# цифры — в общее «type», то есть два таких типа схлопнулись бы в один вместе
# со своими переменными. Найдено E2E-прогоном раздела CMS на присланном файле.
_TRANSLIT = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
    "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "h", "ц": "c", "ч": "ch", "ш": "sh", "щ": "sch", "ъ": "",
    "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
}


def _slug(name: str) -> str:
    import re

    lowered = "".join(_TRANSLIT.get(char, char) for char in name.strip().lower())
    return re.sub(r"[^a-z0-9]+", "-", lowered).strip("-") or "type"


# --- Зоны -------------------------------------------------------------------


def add_zone(hotel, *, room_type_code: str, code: str, title: dict, sort_order: int = 0) -> Zone:
    with tenant_context(hotel):
        room_type = _type(room_type_code)
        return Zone.objects.create(
            room_type=room_type, code=code, title=title, sort_order=sort_order
        )


# --- Элементы ---------------------------------------------------------------


def add_element(
    hotel,
    *,
    room_type_code: str,
    kind: str,
    slug: str,
    zone_code: str = "",
    title: dict | None = None,
    sort_order: int = 0,
) -> ControlElement:
    """
    Поставить элемент каталога в тип.

    Однотипных элементов может быть сколько угодно — два фанкойла, шесть групп
    света, три шторы (ТЗ §11). Различаются они slug'ом, он же `controlId`.
    """
    if kind not in catalog.ELEMENTS:
        raise ValidationError(f"Неизвестный элемент «{kind}»", field="kind")

    with tenant_context(hotel):
        room_type = _type(room_type_code)
        zone = None
        if zone_code:
            zone = Zone.objects.filter(room_type=room_type, code=zone_code).first()
            if zone is None:
                raise NotFoundError(f"Зона «{zone_code}» не найдена")
        if ControlElement.objects.filter(room_type=room_type, slug=slug).exists():
            raise ValidationError(f"Элемент «{slug}» в этом типе уже есть", field="slug")

        return ControlElement.objects.create(
            room_type=room_type,
            zone=zone,
            slug=slug,
            kind=kind,
            title=title or {},
            sort_order=sort_order,
        )


def bind(hotel, *, element_slug: str, room_type_code: str, capability: str,
         variable_key: str, trigger_value: int | None = None) -> Binding:
    """Связать capability элемента с переменной. Валидация — до записи."""
    if capability not in catalog.CAPABILITIES:
        raise ValidationError(f"Неизвестная возможность «{capability}»", field="capability")

    with tenant_context(hotel):
        room_type = _type(room_type_code)
        element = ControlElement.objects.filter(room_type=room_type, slug=element_slug).first()
        if element is None:
            raise NotFoundError(f"Элемент «{element_slug}» не найден")
        variable = Variable.objects.filter(room_type=room_type, key=variable_key).first()
        if variable is None:
            raise NotFoundError(f"Переменная «{variable_key}» не найдена")

        kind = catalog.ELEMENTS[element.kind]
        if capability not in kind.capabilities:
            raise ValidationError(
                f"У элемента «{element.kind}» нет возможности «{capability}»", field="capability"
            )

        problem = check_binding(capability, variable)
        if problem:
            raise ValidationError(problem, field="variable_key")

        binding, _ = Binding.objects.update_or_create(
            element=element,
            capability=capability,
            defaults={"variable": variable, "trigger_value": trigger_value},
        )
        return binding


def check_binding(capability: str, variable: Variable) -> str:
    """
    Совместимость возможности и переменной. Пустая строка — всё в порядке.

    Проверяется ДО публикации (ТЗ §11), потому что несовместимость проявляется
    иначе: гость двигает кольцо термостата, а в оборудование уходит значение
    вне допустимого диапазона.
    """
    spec = catalog.CAPABILITIES[capability]

    if spec.requires_command and not variable.command:
        return f"«{capability}» требует команду, а у переменной «{variable.key}» её нет"
    if not spec.requires_command and variable.command:
        # current_temp — единственный такой случай. Привязав его к переменной
        # С командой, мы бы разрешили запись в параметр, объявленный «только
        # чтение», и обещание read-only перестало бы быть правдой.
        return (
            f"«{capability}» — только чтение, а у переменной «{variable.key}» есть "
            f"команда «{variable.command}»"
        )
    if spec.requires_feedback and not variable.feedback:
        return (
            f"«{capability}» требует обратную связь, а у переменной «{variable.key}» её нет — "
            "подтвердить выполнение будет нечем"
        )
    if variable.value_kind != spec.value_kind:
        return (
            f"«{capability}» работает со значением вида «{spec.value_kind}», "
            f"а переменная «{variable.key}» — «{variable.value_kind}»"
        )
    return ""


# --- Готовность к публикации ------------------------------------------------


@dataclass
class ElementStatus:
    slug: str
    kind: str
    publishable: bool
    problems: list[str]
    bound: list[str]


def element_status(element: ControlElement, bindings: list[Binding]) -> ElementStatus:
    kind = catalog.ELEMENTS[element.kind]
    bound = {b.capability: b for b in bindings}
    problems: list[str] = []

    for capability in kind.required:
        if capability not in bound:
            problems.append(f"не связана обязательная возможность «{capability}»")
    for capability, binding in bound.items():
        issue = check_binding(capability, binding.variable)
        if issue:
            problems.append(issue)

    return ElementStatus(
        slug=element.slug,
        kind=element.kind,
        publishable=not problems,
        problems=problems,
        bound=sorted(bound),
    )


def type_status(hotel, room_type_code: str) -> dict:
    """
    Что попадёт в публикацию, а что останется скрытым.

    Непривязанные элементы — НЕ ошибка публикации, а нормальное состояние
    объекта, где такого оборудования нет. Они просто не попадают в
    опубликованную конфигурацию.

    Кроме приговора отдаётся и САМ ЧЕРНОВИК деревом «зона → элементы →
    привязки». Конструктору в CMS без него нечего показывать: администратор
    иначе добавлял бы вслепую и узнавал о том, что уже добавил, только по
    ошибке «такой элемент уже есть».
    """
    with tenant_context(hotel):
        room_type = _type(room_type_code)
        zones = list(Zone.objects.filter(room_type=room_type).order_by("sort_order", "code"))
        elements = list(
            ControlElement.objects.filter(room_type=room_type)
            .select_related("zone")
            .order_by("sort_order", "slug")
        )
        bindings: dict[str, list[Binding]] = {}
        for binding in Binding.objects.filter(element__room_type=room_type).select_related(
            "variable", "element"
        ):
            bindings.setdefault(binding.element_id, []).append(binding)

        statuses = [element_status(e, bindings.get(e.pk, [])) for e in elements]
        draft = [
            {
                "slug": element.slug,
                "kind": element.kind,
                "title": element.title or {},
                "zone": element.zone.code if element.zone_id else "",
                "publishable": status.publishable,
                "problems": status.problems,
                "bindings": [
                    {"capability": b.capability, "variable": b.variable.key}
                    for b in sorted(bindings.get(element.pk, []), key=lambda b: b.capability)
                ],
            }
            for element, status in zip(elements, statuses)
        ]

    return {
        "type": room_type_code,
        "publishable": [s.slug for s in statuses if s.publishable],
        "hidden": [
            {"slug": s.slug, "kind": s.kind, "problems": s.problems}
            for s in statuses
            if not s.publishable
        ],
        "zones": [
            {"code": zone.code, "title": zone.title or {}, "sort_order": zone.sort_order}
            for zone in zones
        ],
        "elements": draft,
    }


def set_device_override(hotel, *, room_number: str, device_name: str) -> RoomTypeRoom:
    """
    Переопределение имени устройства на комнату (ТЗ §10).

    Реальные объекты не идеально регулярны: одна комната после переделки может
    называться иначе, и менять из-за неё шаблон всего типа нельзя.
    """
    with tenant_context(hotel):
        link = RoomTypeRoom.objects.filter(room__number=room_number).first()
        if link is None:
            raise NotFoundError(f"Комната «{room_number}» не привязана к типу")
        link.device_name_override = device_name
        link.save(update_fields=["device_name_override", "updated_at"])
        return link


def device_for_room(hotel, room_number: str) -> str:
    """Итоговое имя устройства: переопределение важнее шаблона."""
    with tenant_context(hotel):
        link = (
            RoomTypeRoom.objects.select_related("room_type", "room")
            .filter(room__number=room_number)
            .first()
        )
        if link is None:
            raise NotFoundError(f"Комната «{room_number}» не привязана к типу")
        if link.device_name_override:
            return link.device_name_override
        return (link.room_type.device_name_template or "").replace("{room}", room_number)


def _type(code: str) -> RoomType:
    room_type = RoomType.objects.filter(code=code).first()
    if room_type is None:
        raise NotFoundError(f"Тип номера «{code}» не найден")
    return room_type


def list_types_with_variables(hotel) -> list[dict]:
    """
    Типы номеров с их переменными — снимок для конструктора CMS.
    Перенос дословный из вьюхи `api/cms/grms.py`.
    """
    from apps.core.context import tenant_context

    from apps.grms.models import RoomType, Variable

    with tenant_context(hotel):
        result = []
        for room_type in RoomType.objects.all():
            result.append(
                {
                    "code": room_type.code,
                    "title": room_type.title,
                    "device_name_template": room_type.device_name_template,
                    # Уровень плана — редактору, чтобы он знал, какие контролы
                    # у этого типа осмысленны. Сервер всё равно откажет, но
                    # предлагать человеку то, что ему откажут, незачем.
                    "plan_level": room_type.plan_level,
                    "rooms": list(
                        room_type.rooms.select_related("room").values_list(
                            "room__number", flat=True
                        )
                    ),
                    "variables": list(
                        Variable.objects.filter(room_type=room_type).values(
                            "key", "command", "feedback", "value_kind",
                            "min_value", "max_value", "raw_range", "description",
                        )
                    ),
                }
            )
    return result
