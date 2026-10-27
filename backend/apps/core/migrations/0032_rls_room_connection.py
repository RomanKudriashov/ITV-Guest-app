"""RLS для «номер → подключение» (партия 65)."""

from django.db import migrations

from apps.core import rls

TABLES = ["grms_room_connection"]


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0031_rls_control_server"),
        ("grms", "0010_mark_default_connection"),
    ]

    operations = [
        migrations.RunSQL(
            sql=rls.enable_sql(TABLES),
            reverse_sql=rls.disable_sql(TABLES),
        ),
    ]
