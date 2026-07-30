"""RLS для новых tenant-таблиц: гостевой сервис и реестр модулей."""

from django.db import migrations

from apps.core import rls

TABLES = [
    "hotels_service",
    "hotels_hotel_module",
]


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0010_rls_item_data"),
        ("hotels", "0010_service_hotelmodule"),
    ]

    operations = [
        migrations.RunSQL(
            sql=rls.enable_sql(TABLES),
            reverse_sql=rls.disable_sql(TABLES),
        ),
    ]
