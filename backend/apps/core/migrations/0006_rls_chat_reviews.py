"""RLS для таблиц чата и отзывов."""

from django.db import migrations

from apps.core import rls

TABLES = ["chat_thread", "chat_message", "reviews_review"]


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0005_rls_slots"),
        ("chat", "0001_initial"),
        ("reviews", "0001_initial"),
    ]

    operations = [
        migrations.RunSQL(
            sql=rls.enable_sql(TABLES),
            reverse_sql=rls.disable_sql(TABLES),
        ),
    ]
