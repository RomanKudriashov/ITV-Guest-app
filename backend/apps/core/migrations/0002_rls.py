"""
Включает Row-Level Security на всех тенант-таблицах.

Отдельной миграцией в core, а не по кускам в каждом приложении: список
тенант-таблиц — свойство архитектуры, и держать его в одном месте честнее.
Сам список живёт в apps/core/tenant_tables.py, потому что его читает ещё и
тест-сторож.
"""

from django.db import migrations

from apps.core import rls
from apps.core.tenant_tables import NULLABLE_TENANT_TABLES, TENANT_TABLES


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0001_initial"),
        ("hotels", "0001_initial"),
        ("accounts", "0001_initial"),
        ("catalog", "0001_initial"),
        ("orders", "0001_initial"),
        ("media", "0001_initial"),
    ]

    operations = [
        migrations.RunSQL(
            sql=rls.enable_sql(TENANT_TABLES),
            reverse_sql=rls.disable_sql(TENANT_TABLES),
        ),
        migrations.RunSQL(
            sql=rls.enable_sql(NULLABLE_TENANT_TABLES, nullable=True),
            reverse_sql=rls.disable_sql(NULLABLE_TENANT_TABLES),
        ),
    ]
