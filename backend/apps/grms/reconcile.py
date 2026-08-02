"""
Сверка разобранного Excel с ЖИВЫМ сервером iRidi.

Зачем это вообще есть: **Excel не источник истины**. Прозвон G0 показал, что у
ТИП1 в файле десять групп света, а на сервере их двенадцать
(docs/grms/iridi-probe.md §8.2). Настроив интерфейс по файлу, объект получил бы
две группы света, которыми гость не может управлять, и никто бы об этом не
узнал до жалобы.

Как проверяется существование канала — недокументированный дискриминатор из
прозвона (§6.1):

    status "false"                → устройства нет;
    status "true", value "undefined" → устройство есть, тега нет;
    status "true", value иное        → и устройство, и тег есть.

Чтение безопасно: оно ничего не переключает в номере. Командные каналы `C_*`
здесь НЕ проверяются — их существование определяется только реальной записью, а
это дёргало бы свет и шторы у живых гостей.

Коннектор офлайн — не ошибка импорта. Сверка возвращает статус «не проверено»,
и сохранение НЕ блокируется: объект может настраиваться до того, как коробку
подключили.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from apps.grms import adapter, commands, transport

# Насколько дальше последнего номера из Excel заглядывать в поисках лишних
# каналов. Шесть — компромисс: находит забытые в файле группы (у ТИП1 их две),
# но не превращает сверку в перебор на сотню запросов.
PROBE_MARGIN = 6

_FAMILY = re.compile(r"^(?P<base>F_[A-Za-z_]+?)\s*(?P<index>\d+)$")

STATUS_OK = "ok"
STATUS_MISSING_ON_SERVER = "missing_on_server"
STATUS_EXTRA_ON_SERVER = "extra_on_server"
STATUS_DEVICE_MISSING = "device_missing"
STATUS_NOT_CHECKED = "not_checked"


@dataclass
class ChannelReport:
    feedback: str
    status: str
    value: str | int | None = None


@dataclass
class TypeReport:
    type_name: str
    device: str
    checked: bool = False
    reason: str = ""
    channels: list[ChannelReport] = field(default_factory=list)

    @property
    def missing(self) -> list[ChannelReport]:
        return [c for c in self.channels if c.status == STATUS_MISSING_ON_SERVER]

    @property
    def extra(self) -> list[ChannelReport]:
        return [c for c in self.channels if c.status == STATUS_EXTRA_ON_SERVER]

    @property
    def has_discrepancies(self) -> bool:
        return bool(self.missing or self.extra) or self.reason == STATUS_DEVICE_MISSING

    def as_dict(self) -> dict:
        return {
            "type_name": self.type_name,
            "device": self.device,
            "checked": self.checked,
            "reason": self.reason,
            "channels": [vars(c) for c in self.channels],
            "missing": [c.feedback for c in self.missing],
            "extra": [c.feedback for c in self.extra],
        }


def _device_for(template: str, room: str) -> str:
    return (template or "").replace("{room}", room)


def _probe_names(feedbacks: list[str]) -> list[str]:
    """
    Что спрашивать у сервера: всё из Excel плюс продолжение каждой нумерованной
    семьи. Именно продолжение и находит каналы, которых в файле нет.
    """
    names = list(dict.fromkeys(f for f in feedbacks if f))
    families: dict[str, int] = {}
    for name in names:
        match = _FAMILY.match(name)
        if match:
            base = match.group("base").rstrip()
            families[base] = max(families.get(base, 0), int(match.group("index")))

    extra: list[str] = []
    for base, top in families.items():
        for index in range(top + 1, top + 1 + PROBE_MARGIN):
            candidate = f"{base} {index}"
            if candidate not in names:
                extra.append(candidate)
    return names + extra


def reconcile_type(hotel, *, type_name: str, device_name_template: str,
                   reference_room: str, feedbacks: list[str]) -> TypeReport:
    """Сверить один тип по его ЭТАЛОННОЙ комнате."""
    device = _device_for(device_name_template, reference_room)
    report = TypeReport(type_name=type_name, device=device)

    if not transport.node_is_online(hotel):
        # Осознанно НЕ ошибка: объект настраивают и до подключения коробки.
        report.reason = STATUS_NOT_CHECKED
        return report

    known = set(f for f in feedbacks if f)
    for name in _probe_names(feedbacks):
        result = commands.read(hotel, device=device, feedback=name, room=reference_room)

        if result.error == adapter.DEVICE_NOT_FOUND:
            report.reason = STATUS_DEVICE_MISSING
            report.checked = True
            return report
        if result.error in (adapter.CONNECTOR_OFFLINE, adapter.TTL_EXPIRED, adapter.TIMEOUT):
            report.reason = STATUS_NOT_CHECKED
            return report

        exists = result.ok or result.error != adapter.CHANNEL_NOT_FOUND
        if name in known:
            report.channels.append(
                ChannelReport(
                    feedback=name,
                    status=STATUS_OK if exists else STATUS_MISSING_ON_SERVER,
                    value=result.value,
                )
            )
        elif exists:
            # Канал есть на железе, но его нет в файле ПНР — именно так
            # находятся 11-я и 12-я группы света у ТИП1.
            report.channels.append(
                ChannelReport(feedback=name, status=STATUS_EXTRA_ON_SERVER, value=result.value)
            )

    report.checked = True
    return report


def reconcile_preview(hotel, preview) -> list[TypeReport]:
    """Сверить весь предпросмотр импорта."""
    reports = []
    for parsed in preview.types:
        reports.append(
            reconcile_type(
                hotel,
                type_name=parsed.name,
                device_name_template=parsed.device_name_template,
                reference_room=parsed.reference_room,
                feedbacks=[v.feedback for v in parsed.variables if v.feedback],
            )
        )
    return reports


def rooms_present_on_server(hotel, *, device_name_template: str, rooms: list[str]) -> dict:
    """
    Какие комнаты типа реально видны на сервере.

    Отсутствие комнаты на стенде — НЕ ошибка: прозвон нашёл 15 устройств против
    115 комнат в файле, стенд заведомо частичный. Поэтому результат делится на
    «есть» и «не найдено», а не на «ок» и «сломано».
    """
    if not transport.node_is_online(hotel):
        return {"checked": False, "present": [], "absent": []}

    present, absent = [], []
    for room in rooms:
        result = commands.read(
            hotel, device=_device_for(device_name_template, room), feedback="F_DND", room=room
        )
        (absent if result.error == adapter.DEVICE_NOT_FOUND else present).append(room)
    return {"checked": True, "present": present, "absent": absent}
