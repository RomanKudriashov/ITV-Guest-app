"""RLS для маркетинговых бейджей."""

from django.db import migrations

from apps.core import rls

TABLES = ["catalog_badge", "catalog_item_badge"]


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0007_rls_analytics"),
        ("catalog", "0005_badge_itembadge"),
    ]

    operations = [
        migrations.RunSQL(
            sql=rls.enable_sql(TABLES),
            reverse_sql=rls.disable_sql(TABLES),
        ),
    ]
