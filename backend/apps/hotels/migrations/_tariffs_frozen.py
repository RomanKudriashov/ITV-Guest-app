"""
Сетка тарифов, ЗАМОРОЖЕННАЯ для старых миграций (партия 62-E1).

`apps/hotels/services/tariffs.py` удалён вместе с тарифами, а миграции 0022 и
0045 считали по нему «что даёт тариф». Миграции обязаны воспроизводиться на
свежей базе, поэтому им оставлена копия сетки на момент их написания —
тот же приём, что исторические модели в `apps.get_model`. Нового кода здесь
быть не должно.
"""

_GRID = {
    "standard": set(),
    "business": {"multi_restaurant", "room_control", "marketing", "analytics_level"},
    "resort": {
        "multi_restaurant", "room_control", "marketing", "analytics_level",
        "pms", "mobile_key", "extra_languages",
    },
    "trial": {"multi_restaurant", "room_control", "marketing", "analytics_level"},
}


def modules_for(code: str | None) -> set[str]:
    return set(_GRID.get((code or "").strip().lower(), _GRID["standard"]))
