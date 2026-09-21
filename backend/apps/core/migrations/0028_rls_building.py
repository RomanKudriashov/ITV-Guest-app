"""RLS для справочника корпусов: корпус принадлежит отелю."""

from django.db import migrations

from apps.core import rls

TABLES = ["hotels_building"]


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0027_rls_promo"),
        ("hotels", "0040_buildings"),
    ]

    operations = [
        migrations.RunSQL(sql=rls.enable_sql(TABLES), reverse_sql=rls.disable_sql(TABLES)),
    ]
