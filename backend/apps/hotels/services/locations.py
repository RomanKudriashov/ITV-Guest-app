"""
Локации доставки для гостя.

Перенос дословный из вьюхи api/guest.py: правило «в номер бессмысленно без
номера» — часть выборки, а не оформления.
"""

from __future__ import annotations

from apps.hotels.models import Location


def guest_locations(session, language: str) -> dict:
    has_room = session.room_id is not None

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
        "room": session.room.number if has_room else None,
        "locations": locations,
        "delivery_modes": ["delivery", "pickup"],
    }
