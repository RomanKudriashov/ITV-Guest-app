"""
Каталог элементов управления и словарь capabilities.

Живёт В КОДЕ, а не в таблице — как MODULE_LABELS и тарифная сетка. Новый вид
элемента означает новый код на фронте и в адаптере, поэтому строкой в базе он
появиться не может: отель, добавивший себе «элемент» в БД, получил бы запись,
которую нечем нарисовать и нечем исполнить.

Ветвление — ПО CAPABILITY, никогда по kind. Причина в ТЗ §1: подключить GRMS
другого производителя нужно без изменения гостевого интерфейса. У другого
вендора отопление вполне может оказаться отдельным элементом с той же ручкой
уставки; ветвление по kind заставило бы править фронт на каждом объекте.

Контракт: docs/grms/contracts/control-elements.md
Инвентаризация на боевом стенде: docs/grms/iridi-probe.md §6.3
"""

from __future__ import annotations

from dataclasses import dataclass, field


class ValueKind:
    """Тип значения переменной. Совпадает с Variable.ValueKind."""

    BINARY = "binary"  # 0/1
    ENUM = "enum"  # дискретный набор, напр. скорость 0-3
    RANGE = "range"  # диапазон, напр. уставка 16-32


@dataclass(frozen=True)
class Capability:
    """
    Одна ручка элемента.

    requires_command / requires_feedback — то, что проверяется перед публикацией
    конфигурации. Два вырожденных случая здесь не исключения, а норма:
      * trigger  — сцена: команда есть, feedback'а нет (подтверждено прозвоном);
      * current_temp — текущая температура: feedback есть, команды нет.
    """

    code: str
    value_kind: str
    requires_command: bool = True
    requires_feedback: bool = True
    readonly: bool = False


CAPABILITIES: dict[str, Capability] = {
    c.code: c
    for c in [
        Capability("toggle", ValueKind.BINARY),
        # Сцена не имеет состояния: подтверждать нечего, feedback'а у неё нет.
        Capability("trigger", ValueKind.BINARY, requires_feedback=False),
        # 0 — это АВТО, а не «выключено». Выключение фанкойла — это toggle.
        Capability("fan_speed", ValueKind.ENUM),
        Capability("setpoint", ValueKind.RANGE),
        # Единственная read-only ручка: команда на неё отбивается 422.
        Capability("current_temp", ValueKind.RANGE, requires_command=False, readonly=True),
        Capability("position", ValueKind.RANGE),
        Capability("level", ValueKind.RANGE),
    ]
}


@dataclass(frozen=True)
class ElementKind:
    """
    Вид элемента из фиксированного каталога.

    Вид, иконка, логика, тип значений и способ показа состояния фиксированы
    (ТЗ §11). Администратор выбирает элемент, кладёт в зону, задаёт порядок,
    связывает с переменными и может переопределить заголовок — и всё.
    """

    code: str
    title_ru: str
    required: tuple[str, ...]
    optional: tuple[str, ...] = field(default_factory=tuple)

    @property
    def capabilities(self) -> tuple[str, ...]:
        return self.required + self.optional


ELEMENTS: dict[str, ElementKind] = {
    e.code: e
    for e in [
        ElementKind("dnd", "Не беспокоить", ("toggle",)),
        ElementKind("mur", "Убрать номер", ("toggle",)),
        # На объектах реализуется сценой (MASTER_OFF), а не отдельным каналом:
        # тега F_MasterSw на стенде нет.
        ElementKind("master_switch", "Мастер-выключатель", ("trigger",)),
        ElementKind("light_group", "Группа света", ("toggle",)),
        # Шторы на этом объекте бинарные (0-Close, 1-Open); position — задел
        # под приводы с позиционированием.
        ElementKind("curtain", "Шторы", ("toggle",), ("position",)),
        ElementKind("curtain_blackout", "Блэкаут-шторы", ("toggle",), ("position",)),
        # Составной элемент: ОДИН controlId на четыре переменные. Резать его на
        # четыре независимых нельзя — тогда термостат собирал бы фронт.
        ElementKind(
            "air_conditioner",
            "Кондиционер",
            ("toggle",),
            ("fan_speed", "setpoint", "current_temp"),
        ),
        ElementKind("heating", "Отопление", ("toggle",), ("setpoint", "current_temp")),
        ElementKind("scene", "Сцена", ("trigger",)),
    ]
}

ELEMENT_CODES = tuple(ELEMENTS)
CAPABILITY_CODES = tuple(CAPABILITIES)

# Choices для полей моделей — каталог остаётся единственным источником правды.
ELEMENT_CHOICES = [(e.code, e.title_ru) for e in ELEMENTS.values()]
CAPABILITY_CHOICES = [(code, code) for code in CAPABILITY_CODES]
