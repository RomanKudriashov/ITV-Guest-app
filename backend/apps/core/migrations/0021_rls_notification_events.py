"""
RLS для журнала событий уведомлений.

Отдельной миграцией, следующей за созданием таблиц (notifications/0002), —
так же, как для версий оформления и категорий номеров. Журнал несёт данные
событий отеля (комментарии гостей, номера комнат): чужой отель не должен
увидеть ни строки.
"""

from django.db import migrations

from apps.core import rls

TABLES = ["notifications_event", "notifications_event_delivery"]


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0020_rls_room_category"),
        ("notifications", "0002_event_journal"),
    ]

    operations = [
        migrations.RunSQL(
            sql=rls.enable_sql(TABLES),
            reverse_sql=rls.disable_sql(TABLES),
        ),
    ]
