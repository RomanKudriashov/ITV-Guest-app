from __future__ import annotations

from pathlib import Path

from apps.catalog.models import Item, ModifierGroup
from apps.core.context import tenant_context
from apps.hotels.models import Location

# ОДНО МЕСТО ДЛЯ КОРНЕЙ. Считать путь от `__file__` через `parents[N]` внутри
# теста нельзя: стоит файлу переехать на уровень глубже, и «корень репозитория»
# молча превращается в другую папку — а тест, читающий картинку, падает не там,
# где ошибка.
TESTS_DIR = Path(__file__).resolve().parent
FIXTURES = TESTS_DIR / "fixtures"
REPO_ROOT = TESTS_DIR.parent.parent


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


def png_bytes(size: tuple[int, int] = (800, 600)) -> bytes:
    """
    Настоящий PNG для проверок медиапайплайна.

    Живёт ЗДЕСЬ, а не в тесте медиа: помощник понадобился и каталогу (фото
    точки исполнения), и тест каталога стал импортировать тестовый модуль
    соседнего домена. Тест, зависящий от другого теста, ломается от правки,
    к нему не относящейся, — и порядок раскладки этого не показывает.
    """
    import io

    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", size, (12, 34, 56)).save(buffer, format="PNG")
    return buffer.getvalue()
