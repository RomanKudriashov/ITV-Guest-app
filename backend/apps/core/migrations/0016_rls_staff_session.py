"""
RLS для реестра сессий персонала.

Политика НЕ строгая, а nullable: у платформенного администратора отеля нет, и
его сессии обязаны быть невидимы роли приложения — ровно как его строка в
`accounts_user`. Строгая политика скрыла бы их и от платформенной роли тоже,
то есть от единственного, кому они нужны.
"""

from django.db import migrations

from apps.core import rls

TABLES = ["accounts_staff_session"]


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0015_rls_grms_room_pin"),
        ("accounts", "0006_staff_session"),
    ]

    operations = [
        migrations.RunSQL(
            sql=rls.enable_sql(TABLES, nullable=True),
            reverse_sql=rls.disable_sql(TABLES),
        ),
    ]
