"""
Схема модуля «Управление номером (GRMS)».

Контракты:
    docs/grms/contracts/room-type-config.md   — что хранит тип, версии, откат
    docs/grms/contracts/control-elements.md   — каталог и capabilities
    docs/grms/reuse-map.md                    — что берём готовым
Прозвон боевого сервера: docs/grms/iridi-probe.md

Все таблицы — тенантные, все закрыты RLS FORCE (core/0014_rls_grms). Держать
эту конфигурацию в hotel.settings нельзя: она описывает, какая команда уходит
в какое физическое оборудование, и ошибка в скоупе означает управление чужим
номером. JSON-поле не даёт ни ссылочной целостности с Room, ни версий с
откатом, ни строчной изоляции.

Модели разложены по ресурсам, но импортируются по-прежнему из
`apps.grms.models`: таблицы, app_label и политики RLS не менялись.
"""

from __future__ import annotations

from .element import Binding, ControlElement
from .pin import RoomPin
from .published import PublishedConfig
from .room_type import RoomType, RoomTypeRoom
from .variable import Variable
from .zone import Zone

__all__ = [
    "Binding",
    "ControlElement",
    "PublishedConfig",
    "RoomPin",
    "RoomType",
    "RoomTypeRoom",
    "Variable",
    "Zone",
]
