"""RLS для таблиц включений сервисов (кросс-ссылки контента)."""

from django.db import migrations

from apps.core import rls

TABLES = [
    "catalog_service_inclusion",
    "catalog_service_inclusion_category",
    "catalog_service_inclusion_hidden",
]


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0011_rls_service_modules"),
        ("catalog", "0010_service_inclusion"),
    ]

    operations = [
        migrations.RunSQL(
            sql=rls.enable_sql(TABLES),
            reverse_sql=rls.disable_sql(TABLES),
        ),
    ]
