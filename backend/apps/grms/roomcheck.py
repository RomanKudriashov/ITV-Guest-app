"""
Проверка элемента на выбранной комнате — до публикации.

Единственный момент во всей системе, когда команда уходит в номер НЕ от гостя.
Поэтому здесь показывается ПОЛНЫЙ обмен, включая перечитывание feedback: смысл
проверки в том, чтобы администратор увидел своими глазами, доехала ли команда
до железа, а не поверил зелёной галочке.

Отдельно и честно про боевой стенд: там feedback мёртв (все теги отдают
`false` и после SET не меняются, docs/grms/iridi-probe.md §7). Проверка обязана
показать это как СОСТОЯНИЕ СТЕНДА, а не выдать за неисправность конфигурации.
Администратор, которому показали «не подтверждено» без объяснения, пойдёт
переделывать правильный маппинг.
"""

from __future__ import annotations

from apps.core.context import tenant_context
from apps.core.errors import NotFoundError, ValidationError
from apps.grms import adapter, builder, catalog, commands
from apps.grms.models import Binding, ControlElement

# Итоги проверки, отличные от исходов команды: администратору важно не только
# «сработало / не сработало», но и ПОЧЕМУ подтверждения нет.
OUTCOME_CONFIRMED = "confirmed"
OUTCOME_NO_FEEDBACK_CHANNEL = "no_feedback_channel"
OUTCOME_FEEDBACK_DEAD = "feedback_dead"
OUTCOME_UNCONFIRMED = "unconfirmed"
OUTCOME_FAILED = "failed"


def check_element(
    hotel,
    *,
    room_type_code: str,
    element_slug: str,
    room_number: str,
    capability: str = "",
    value=None,
) -> dict:
    """
    Прогнать один элемент на конкретной комнате и вернуть весь обмен.

    `value` не обязателен: без него делается только ЧТЕНИЕ. Так администратор
    может проверить маппинг, ничего не переключая в занятом номере, — и это
    поведение по умолчанию не случайно.
    """
    with tenant_context(hotel):
        room_type = builder._type(room_type_code)
        element = ControlElement.objects.filter(
            room_type=room_type, slug=element_slug
        ).first()
        if element is None:
            raise NotFoundError(f"Элемент «{element_slug}» не найден")
        bindings = list(
            Binding.objects.filter(element=element).select_related("variable")
        )

    if not bindings:
        raise ValidationError(
            f"Элемент «{element_slug}» ни с чем не связан — проверять нечего",
            field="element_slug",
        )

    device = builder.device_for_room(hotel, room_number)
    kind = catalog.ELEMENTS[element.kind]

    chosen = capability or _default_capability(kind, bindings)
    binding = next((b for b in bindings if b.capability == chosen), None)
    if binding is None:
        raise ValidationError(
            f"У элемента «{element_slug}» нет связанной возможности «{chosen}»",
            field="capability",
        )

    variable = binding.variable
    steps: list[dict] = []

    # 1. Чтение ДО. Показывает, отвечает ли железо вообще.
    before = None
    if variable.feedback:
        before = commands.read(
            hotel, device=device, feedback=variable.feedback, room=room_number
        )
        steps.append(_step("read_before", variable.feedback, before))

    if value is None:
        return _result(
            element, chosen, device, room_number, steps,
            outcome=OUTCOME_CONFIRMED if (before and before.ok) else OUTCOME_FAILED,
            note="Выполнено только чтение — команда не отправлялась.",
        )

    # 2. Команда.
    outcome = commands.send_command(
        hotel,
        device=device,
        channel=variable.command,
        value=value,
        feedback=variable.feedback,
        # subdevice — свойство ТИПА, а не переменной: на этом объекте он пуст,
        # и «Custom» из примеров ТЗ ломал бы адресацию (прозвон §8.1).
        subdevice=room_type.subdevice or "",
        room=room_number,
    )
    steps.append(
        {
            "step": "set",
            "channel": variable.command,
            "sent": value,
            "result": outcome["result"],
            "error": outcome.get("error"),
            "observed": outcome.get("value"),
        }
    )

    return _result(
        element, chosen, device, room_number, steps,
        outcome=_classify(outcome, variable, before),
        note=_note(outcome, variable, before),
    )


def _default_capability(kind, bindings) -> str:
    """Берём первую ОБЯЗАТЕЛЬНУЮ возможность — она есть у элемента всегда."""
    bound = {b.capability for b in bindings}
    for capability in kind.required:
        if capability in bound:
            return capability
    return sorted(bound)[0]


def _classify(outcome: dict, variable, before) -> str:
    if outcome["result"] == commands.RESULT_FAILED:
        return OUTCOME_FAILED
    if outcome["result"] == commands.RESULT_ACCEPTED:
        return OUTCOME_NO_FEEDBACK_CHANNEL
    if outcome["result"] == commands.RESULT_CONFIRMED:
        return OUTCOME_CONFIRMED

    # Неподтверждено И обратная связь не двигалась вовсе — это ровно картина
    # боевого стенда, где Modbus-обмен не поднят.
    if before is not None and before.ok and outcome.get("value") == before.value:
        return OUTCOME_FEEDBACK_DEAD
    return OUTCOME_UNCONFIRMED


def _note(outcome: dict, variable, before) -> str:
    kind = _classify(outcome, variable, before)
    if kind == OUTCOME_NO_FEEDBACK_CHANNEL:
        return (
            "У канала нет обратной связи (норма для сцен): успешная отправка и есть успех, "
            "подтверждать нечем."
        )
    if kind == OUTCOME_FEEDBACK_DEAD:
        return (
            "Команда принята сервером, но обратная связь не изменилась. На стенде iRidi без "
            "поднятого обмена с GRMS так ведут себя ВСЕ каналы — это состояние стенда, "
            "а не ошибка маппинга. Проверьте на объекте с живым оборудованием."
        )
    if kind == OUTCOME_UNCONFIRMED:
        return (
            "Команда принята, но состояние не подтвердилось за окно перечитывания. "
            "Оборудование могло не успеть — повторите проверку."
        )
    if kind == OUTCOME_FAILED:
        return "Команда не выполнена: см. код ошибки в шагах обмена."
    return ""


def _step(name: str, channel: str, result: adapter.IridiResult) -> dict:
    return {
        "step": name,
        "channel": channel,
        "ok": result.ok,
        "value": result.value,
        "error": result.error,
        # Сырой ответ показываем администратору как есть: именно он отвечает
        # на вопрос «а что реально сказало железо».
        "raw": result.raw,
    }


def _result(element, capability, device, room, steps, *, outcome, note) -> dict:
    return {
        "element": element.slug,
        "kind": element.kind,
        "capability": capability,
        "device": device,
        "room": room,
        "outcome": outcome,
        "note": note,
        "steps": steps,
    }
