"""RLS для реестра он-прем узлов (R6)."""

from django.db import migrations

from apps.core import rls

TABLES = ["hotels_onprem_node"]


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0012_rls_inclusions"),
        ("hotels", "0013_hotel_tariff_started_on_hotel_trial_ends_at_and_more"),
    ]

    operations = [
        migrations.RunSQL(
            sql=rls.enable_sql(TABLES),
            reverse_sql=rls.disable_sql(TABLES),
        ),
    ]
