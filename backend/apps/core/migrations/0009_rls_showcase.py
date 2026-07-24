"""RLS для плиток главной-витрины."""

from django.db import migrations

from apps.core import rls

TABLES = ["hotels_showcase_tile"]


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0008_rls_badges"),
        ("hotels", "0007_hotel_showcase_group_threshold_showcasetile"),
    ]

    operations = [
        migrations.RunSQL(
            sql=rls.enable_sql(TABLES),
            reverse_sql=rls.disable_sql(TABLES),
        ),
    ]
