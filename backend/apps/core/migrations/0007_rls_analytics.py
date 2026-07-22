"""RLS для аналитических таблиц."""

from django.db import migrations

from apps.core import rls

TABLES = [
    "analytics_event",
    "analytics_order_daily",
    "analytics_item_daily",
    "analytics_modifier_daily",
    "analytics_session_daily",
    "analytics_review_daily",
    "analytics_export",
]


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0006_rls_chat_reviews"),
        ("analytics", "0001_initial"),
    ]

    operations = [
        migrations.RunSQL(
            sql=rls.enable_sql(TABLES),
            reverse_sql=rls.disable_sql(TABLES),
        ),
    ]
