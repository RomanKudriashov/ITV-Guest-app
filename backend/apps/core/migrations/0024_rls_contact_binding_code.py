"""
RLS для одноразовых кодов привязки мессенджеров.

Строгая политика: код всегда принадлежит сотруднику отеля. Обмен идёт
платформенным подключением — бот один на все отели.
"""

from django.db import migrations

from apps.core import rls

TABLES = ["accounts_contact_binding_code"]


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0023_rls_notification_event_setting"),
        ("accounts", "0007_staff_contacts"),
    ]

    operations = [
        migrations.RunSQL(
            sql=rls.enable_sql(TABLES),
            reverse_sql=rls.disable_sql(TABLES),
        ),
    ]
