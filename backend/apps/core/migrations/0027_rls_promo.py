"""RLS для рекламы: баннеры, их кадры, связь с категориями и статистика.

Статистика особенно: по ней отель считает эффективность своих денег, и видеть
чужие показы нельзя.
"""

from django.db import migrations

from apps.core import rls

TABLES = ["promo_banner", "promo_banner_category", "promo_banner_image", "promo_banner_view"]


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0026_rls_translate"),
        ("promo", "0001_initial"),
    ]

    operations = [
        migrations.RunSQL(
            sql=rls.enable_sql(TABLES),
            reverse_sql=rls.disable_sql(TABLES),
        ),
    ]
