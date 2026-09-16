"""
RLS для настроек событий уведомлений.

Отдельной миграцией после создания таблицы (notifications/0003), как у журнала
событий: в настройке лежат тексты отеля и выбор его каналов.
"""

from django.db import migrations

from apps.core import rls

TABLES = ["notifications_event_setting"]


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0022_scheduler_heartbeat_by_kind"),
        ("notifications", "0003_event_setting"),
    ]

    operations = [
        migrations.RunSQL(
            sql=rls.enable_sql(TABLES),
            reverse_sql=rls.disable_sql(TABLES),
        ),
    ]
