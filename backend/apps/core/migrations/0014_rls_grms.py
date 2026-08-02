"""
RLS для таблиц управления номером (GRMS, G0).

Идёт ПОСЛЕ grms/0001_initial — политику таблице ставит миграция, следующая за
её созданием (см. apps/core/rls.py). Сторож tests/test_rls_coverage проверяет,
что в итоге политика есть у каждой таблицы с hotel_id.
"""

from django.db import migrations

from apps.core import rls

TABLES = [
    "grms_room_type",
    "grms_room_type_room",
    "grms_zone",
    "grms_variable",
    "grms_control_element",
    "grms_binding",
    "grms_published_config",
]


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0013_rls_onprem_node"),
        ("grms", "0001_initial"),
    ]

    operations = [
        migrations.RunSQL(
            sql=rls.enable_sql(TABLES),
            reverse_sql=rls.disable_sql(TABLES),
        ),
    ]
