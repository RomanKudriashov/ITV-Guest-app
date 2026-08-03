"""
RLS для таблицы PIN проживания (G5).

Отдельной миграцией, а не правкой 0014: политику таблице ставит миграция,
СЛЕДУЮЩАЯ за её созданием (apps/core/rls.py), а таблица появилась в grms/0002.
Сторож tests/test_rls_coverage упадёт, если про неё забыть.
"""

from django.db import migrations

from apps.core import rls

TABLES = ["grms_room_pin"]


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0014_rls_grms"),
        ("grms", "0002_roompin"),
    ]

    operations = [
        migrations.RunSQL(
            sql=rls.enable_sql(TABLES),
            reverse_sql=rls.disable_sql(TABLES),
        ),
    ]
