"""RLS для таблиц брони слотов."""

from django.db import migrations

from apps.core import rls

TABLES = ["catalog_slot_config", "catalog_slot_booking"]


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0004_rls_notifications"),
        ("catalog", "0003_item_content_alter_category_type_alter_item_type_and_more"),
    ]

    operations = [
        migrations.RunSQL(
            sql=rls.enable_sql(TABLES),
            reverse_sql=rls.disable_sql(TABLES),
        ),
    ]
