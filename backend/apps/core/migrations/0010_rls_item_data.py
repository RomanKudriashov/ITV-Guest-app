"""RLS для справочников аллергенов/маркеров, их join-таблиц и характеристик."""

from django.db import migrations

from apps.core import rls

TABLES = [
    "catalog_allergen",
    "catalog_item_allergen",
    "catalog_dietary_marker",
    "catalog_item_dietary_marker",
    "catalog_item_characteristic",
]


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0009_rls_showcase"),
        ("catalog", "0006_allergen_dietarymarker_itemallergen_and_more"),
    ]

    operations = [
        migrations.RunSQL(
            sql=rls.enable_sql(TABLES),
            reverse_sql=rls.disable_sql(TABLES),
        ),
    ]
