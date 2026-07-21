"""RLS для таблиц уведомлений и эскалации."""

from django.db import migrations

from apps.core import rls

TABLES = [
    "notifications_channel",
    "notifications_escalation_rule",
    "notifications_escalation_step",
    "notifications_log",
]


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0003_rls_request_field"),
        ("notifications", "0001_initial"),
    ]

    operations = [
        migrations.RunSQL(
            sql=rls.enable_sql(TABLES),
            reverse_sql=rls.disable_sql(TABLES),
        ),
    ]
