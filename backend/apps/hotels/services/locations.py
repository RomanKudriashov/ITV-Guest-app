"""
Локации доставки для гостя.

Перенос дословный из вьюхи api/guest.py: правило «в номер бессмысленно без
номера» — часть выборки, а не оформления.
"""

from __future__ import annotations

from apps.hotels.models import Location


def guest_locations(session, language: str) -> dict:
    """Локации для гостя: «в номер» показывается только тому, у кого номер есть."""
    room = session.room.number if session.room_id else None
    return locations_payload(language=language, room_number=room)


def locations_payload(*, language: str, room_number: str | None) -> dict:
    """
    ОТ СЕССИИ ЗДЕСЬ ЗАВИСИТ РОВНО ОДНО — НОМЕР ГОСТЯ. Вынесено доводом, чтобы
    показ витрины в настройке бренда звал ТОТ ЖЕ сборщик: оператор смотрит на
    экран оформления глазами гостя без номера.

    Номером, а не признаком «номер есть»: признака хватало на отбор локаций, но
    не на ответ — в нём номер называется. Первая редакция взяла признак и
    оставила в теле `session`, которой здесь уже нет: гостевые локации отвечали
    500, пока это не поймал полный прогон.
    """
    has_room = room_number is not None

    locations = []
    for location in Location.objects.filter(is_active=True).order_by("sort_order", "code"):
        # Локация «в номер» бессмысленна для гостя без номера — он пришёл по
        # ссылке без комнаты, и доставлять некуда.
        if location.kind == Location.Kind.IN_ROOM and not has_room:
            continue
        locations.append(
            {
                "id": str(location.pk),
                "code": location.code,
                "kind": location.kind,
                "title": location.tr("title", language),
                "requires_refinement": location.requires_refinement,
                "refinement_label": location.tr("refinement_label", language) or None,
                "is_default": location.kind == Location.Kind.IN_ROOM and has_room,
            }
        )

    return {
        "room": room_number,
        "locations": locations,
        "delivery_modes": ["delivery", "pickup"],
    }
