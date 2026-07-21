"""RLS для новой тенант-таблицы полей заявки."""

from django.db import migrations

from apps.core import rls

TABLES = ["catalog_request_field"]


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0002_rls"),
        ("catalog", "0002_item_location_mode_alter_category_type_and_more"),
    ]

    operations = [
        migrations.RunSQL(
            sql=rls.enable_sql(TABLES),
            reverse_sql=rls.disable_sql(TABLES),
        ),
    ]
