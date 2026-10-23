"""RLS для сервера управления отеля (партия 63-3)."""

from django.db import migrations

from apps.core import rls

TABLES = ["grms_control_server"]


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0030_rls_order_transfer"),
        ("grms", "0008_control_server"),
    ]

    operations = [
        migrations.RunSQL(
            sql=rls.enable_sql(TABLES),
            reverse_sql=rls.disable_sql(TABLES),
        ),
    ]
