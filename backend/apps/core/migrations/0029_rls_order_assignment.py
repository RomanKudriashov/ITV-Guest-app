"""RLS для журнала назначений исполнителя (партия 47)."""

from django.db import migrations

from apps.core import rls

TABLES = ["orders_order_assignment"]


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0028_rls_building"),
        ("orders", "0017_order_assignment"),
    ]

    operations = [
        migrations.RunSQL(
            sql=rls.enable_sql(TABLES),
            reverse_sql=rls.disable_sql(TABLES),
        ),
    ]
