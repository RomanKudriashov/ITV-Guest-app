"""RLS для журнала переносов заказа (партия 48)."""

from django.db import migrations

from apps.core import rls

TABLES = ["orders_order_transfer"]


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0029_rls_order_assignment"),
        ("orders", "0018_order_transfer"),
    ]

    operations = [
        migrations.RunSQL(
            sql=rls.enable_sql(TABLES),
            reverse_sql=rls.disable_sql(TABLES),
        ),
    ]
