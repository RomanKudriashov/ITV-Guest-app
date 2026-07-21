from __future__ import annotations

from apps.catalog.models import Item, ModifierGroup
from apps.core.context import tenant_context
from apps.hotels.models import Location


def order_payload(hotel, *, item_code: str = "caesar", quantity: int = 1) -> dict:
    """
    Валидное тело заказа для демо-отеля: позиция + обязательные модификаторы
    (у стейка это «Прожарка») + доставка в номер.
    """
    with tenant_context(hotel):
        item = Item.objects.get(code=item_code)
        location = Location.objects.get(code="in_room")
        modifier_option_ids = []
        for group in ModifierGroup.objects.filter(item=item, is_required=True):
            option = group.options.filter(is_active=True).order_by("sort_order").first()
            if option is not None:
                modifier_option_ids.append(str(option.pk))

        return {
            "lines": [
                {
                    "item_id": str(item.pk),
                    "quantity": quantity,
                    "modifier_option_ids": modifier_option_ids,
                    "comment": "",
                }
            ],
            "location_id": str(location.pk),
            "location_refinement": "",
            "delivery_mode": "delivery",
            "comment": "без лука",
        }
