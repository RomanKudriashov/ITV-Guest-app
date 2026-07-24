"""
Бэкфилл легаси item.flags / item.allergens в новую модель, ПЕРЕД дропом колонок.

Раскладываем по назначению (как решено в C5): аллергены-массив → ItemAllergen;
маркер-флаги → ItemDietaryMarker; spicy → характеристика «Вкус→Острое»;
маркетинговые флаги (popular/new/chef_choice) → существующие пресеты бейджей
Хит/Новинка/Выбор шефа (заводим у отеля, если их нет — параллельный набор с тем
же смыслом создавать нельзя).

Идемпотентно (get_or_create). RLS не мешает: на стенде/проде гоняет
платформенная роль (BYPASSRLS), в тестах таблицы пусты — цикл по items
не выполняется, INSERT'ов нет.
"""

from django.db import migrations

from apps.catalog.vocabularies import ALLERGENS, DIETARY_MARKERS, DIETARY_MARKER_CODES

FLAG_TO_BADGE_PRESET = {"popular": "hit", "new": "new", "chef_choice": "chef_choice"}
BADGE_PRESETS = {
    "hit": ({"ru": "Хит", "en": "Hit"}, "accent", 0),
    "new": ({"ru": "Новинка", "en": "New"}, "info", 1),
    "chef_choice": ({"ru": "Выбор шефа", "en": "Chef's choice"}, "gold", 2),
}
SPICY_NAME = {"ru": "Вкус", "en": "Taste", "ar": "المذاق", "zh": "口味"}
SPICY_VALUE = {"ru": "Острое", "en": "Spicy", "ar": "حار", "zh": "辣"}
SPICY_SORT = 900  # маркер идемпотентности характеристики из spicy


def backfill(apps, schema_editor):
    db = schema_editor.connection.alias
    Hotel = apps.get_model("hotels", "Hotel")
    Item = apps.get_model("catalog", "Item")
    Allergen = apps.get_model("catalog", "Allergen")
    DietaryMarker = apps.get_model("catalog", "DietaryMarker")
    ItemAllergen = apps.get_model("catalog", "ItemAllergen")
    ItemDietaryMarker = apps.get_model("catalog", "ItemDietaryMarker")
    ItemCharacteristic = apps.get_model("catalog", "ItemCharacteristic")
    Badge = apps.get_model("catalog", "Badge")
    ItemBadge = apps.get_model("catalog", "ItemBadge")

    # 1) У каждого отеля должны быть системные словари, иначе коды не в что мапить.
    for hotel in Hotel.objects.using(db).all():
        for order, entry in enumerate(ALLERGENS):
            Allergen.objects.using(db).get_or_create(
                hotel_id=hotel.pk, code=entry["code"],
                defaults={"title": entry["title"], "is_system": True, "sort_order": order},
            )
        for order, entry in enumerate(DIETARY_MARKERS):
            DietaryMarker.objects.using(db).get_or_create(
                hotel_id=hotel.pk, code=entry["code"],
                defaults={"title": entry["title"], "is_system": True, "sort_order": order},
            )

    # 2) Разложить легаси-поля позиций.
    for item in Item.objects.using(db).all():
        hid = item.hotel_id
        for allergen in Allergen.objects.using(db).filter(hotel_id=hid, code__in=(item.allergens or [])):
            ItemAllergen.objects.using(db).get_or_create(hotel_id=hid, item=item, allergen=allergen)

        flags = item.flags or []
        marker_flags = [f for f in flags if f in DIETARY_MARKER_CODES]
        for marker in DietaryMarker.objects.using(db).filter(hotel_id=hid, code__in=marker_flags):
            ItemDietaryMarker.objects.using(db).get_or_create(hotel_id=hid, item=item, marker=marker)

        if "spicy" in flags and not ItemCharacteristic.objects.using(db).filter(
            item=item, sort_order=SPICY_SORT
        ).exists():
            ItemCharacteristic.objects.using(db).create(
                hotel_id=hid, item=item, name=SPICY_NAME, value=SPICY_VALUE, sort_order=SPICY_SORT
            )

        for flag in flags:
            preset = FLAG_TO_BADGE_PRESET.get(flag)
            if not preset:
                continue
            label, role, order = BADGE_PRESETS[preset]
            badge, _ = Badge.objects.using(db).get_or_create(
                hotel_id=hid, preset=preset,
                defaults={"label": label, "color_role": role, "sort_order": order},
            )
            ItemBadge.objects.using(db).get_or_create(
                hotel_id=hid, item=item, badge=badge, defaults={"sort_order": order}
            )


class Migration(migrations.Migration):
    dependencies = [
        ("catalog", "0006_allergen_dietarymarker_itemallergen_and_more"),
    ]

    operations = [
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
