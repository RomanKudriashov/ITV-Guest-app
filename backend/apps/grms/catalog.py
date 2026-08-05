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

    ИКОНКА И ПОДПИСИ СОСТОЯНИЯ ЖИВУТ ЗДЕСЬ, а не на фронте, и это не мелочь.
    Отличить свет от шторы фронт может только по `kind` или по `controlId`, а
    разбирать идентификатор строкой ему запрещено: это ключ, а не признак типа.
    Оставался единственный способ — придумывать слова и глифы на клиенте, и
    тогда «Блэкаут» получал подпись «ОТКРЫТА», а все сцены — один значок.

    `icon` — код глифа из реестра фронта; неизвестный код там падает на
    умолчание, поэтому новый вид элемента не ломает экран.

    `states` — что написать под названием, когда элемент включён и когда
    выключен. Слова разные по смыслу: у шторы «открыта», у блэкаута «закрыт»,
    у «не беспокоить» — «персонал не побеспокоит».
    """

    code: str
    title_ru: str
    required: tuple[str, ...]
    optional: tuple[str, ...] = field(default_factory=tuple)
    icon: str = "switch"
    states: dict[str, dict[str, str]] = field(default_factory=dict)
    # Брать глиф ЗОНЫ, если он задан. Верно ровно для групп света: «свет в
    # спальне» читается кроватью, а не лампочкой. Штора в гостиной остаётся
    # шторой, и подставлять ей диван — терять смысл значка.
    prefers_zone_icon: bool = False

    @property
    def capabilities(self) -> tuple[str, ...]:
        return self.required + self.optional


ELEMENTS: dict[str, ElementKind] = {
    e.code: e
    for e in [
        ElementKind(
            "dnd", "Не беспокоить", ("toggle",),
            icon="do-not-disturb",
            states={
                "on": {"ru": "персонал не побеспокоит", "en": "staff will not disturb",
                       "ar": "لن يزعجك الطاقم", "zh": "员工不会打扰"},
                "off": {"ru": "выключено", "en": "off", "ar": "متوقف", "zh": "已关闭"},
            },
        ),
        ElementKind(
            "mur", "Убрать номер", ("toggle",),
            icon="make-up-room",
            states={
                "on": {"ru": "заявка передана", "en": "request sent",
                       "ar": "تم إرسال الطلب", "zh": "已发送请求"},
                "off": {"ru": "выключено", "en": "off", "ar": "متوقف", "zh": "已关闭"},
            },
        ),
        # На объектах реализуется сценой (MASTER_OFF), а не отдельным каналом:
        # тега F_MasterSw на стенде нет.
        ElementKind("master_switch", "Мастер-выключатель", ("trigger",), icon="power"),
        ElementKind(
            "light_group", "Группа света", ("toggle",),
            icon="light",
            prefers_zone_icon=True,
            states={
                "on": {"ru": "включено", "en": "on", "ar": "مشغّل", "zh": "已开启"},
                "off": {"ru": "выключено", "en": "off", "ar": "متوقف", "zh": "已关闭"},
            },
        ),
        # Шторы на этом объекте бинарные (0-Close, 1-Open); position — задел
        # под приводы с позиционированием.
        ElementKind(
            "curtain", "Шторы", ("toggle",), ("position",),
            icon="curtain",
            states={
                "on": {"ru": "открыта", "en": "open", "ar": "مفتوحة", "zh": "已打开"},
                "off": {"ru": "закрыта", "en": "closed", "ar": "مغلقة", "zh": "已关闭"},
            },
        ),
        ElementKind(
            "curtain_blackout", "Блэкаут-шторы", ("toggle",), ("position",),
            icon="blackout",
            # Мужской род и по смыслу затемнения: «Блэкаут открыта» — это не
            # опечатка вида, а слово, придуманное не за тот элемент.
            states={
                "on": {"ru": "открыт", "en": "open", "ar": "مفتوح", "zh": "已打开"},
                "off": {"ru": "закрыт", "en": "closed", "ar": "مغلق", "zh": "已关闭"},
            },
        ),
        # Составной элемент: ОДИН controlId на четыре переменные. Резать его на
        # четыре независимых нельзя — тогда термостат собирал бы фронт.
        ElementKind(
            "air_conditioner",
            "Кондиционер",
            ("toggle",),
            ("fan_speed", "setpoint", "current_temp"),
            icon="air-conditioner",
            states={
                "on": {"ru": "включён", "en": "on", "ar": "مشغّل", "zh": "已开启"},
                "off": {"ru": "выключен", "en": "off", "ar": "متوقف", "zh": "已关闭"},
            },
        ),
        ElementKind(
            "heating", "Отопление", ("toggle",), ("setpoint", "current_temp"),
            icon="heating",
            states={
                "on": {"ru": "включено", "en": "on", "ar": "مشغّل", "zh": "已开启"},
                "off": {"ru": "выключено", "en": "off", "ar": "متوقف", "zh": "已关闭"},
            },
        ),
        ElementKind("scene", "Сцена", ("trigger",), icon="scene"),
    ]
}

ELEMENT_CODES = tuple(ELEMENTS)
CAPABILITY_CODES = tuple(CAPABILITIES)

# Choices для полей моделей — каталог остаётся единственным источником правды.
ELEMENT_CHOICES = [(e.code, e.title_ru) for e in ELEMENTS.values()]
CAPABILITY_CHOICES = [(code, code) for code in CAPABILITY_CODES]
