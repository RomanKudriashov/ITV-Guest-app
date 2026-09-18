"""RLS для автоперевода: отметки, прогоны и расход принадлежат отелю.

Расход особенно: по нему считают деньги, и видеть чужой отель в нём нельзя.
"""

from django.db import migrations

from apps.core import rls

TABLES = ["translate_mark", "translate_run", "translate_usage"]


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0025_rls_review_action"),
        ("translate", "0001_initial"),
    ]

    operations = [
        migrations.RunSQL(
            sql=rls.enable_sql(TABLES),
            reverse_sql=rls.disable_sql(TABLES),
        ),
    ]
