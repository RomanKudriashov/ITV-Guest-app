"""RLS для журнала разбора отзывов: шаг разбора всегда принадлежит отелю."""

from django.db import migrations

from apps.core import rls

TABLES = ["reviews_action"]


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0024_rls_contact_binding_code"),
        ("reviews", "0005_triage"),
    ]

    operations = [
        migrations.RunSQL(
            sql=rls.enable_sql(TABLES),
            reverse_sql=rls.disable_sql(TABLES),
        ),
    ]
