"""
RLS для категорий номеров.

Отдельной миграцией, а не правкой прежних: политику таблице ставит миграция,
СЛЕДУЮЩАЯ за её созданием (`apps/core/rls.py`), а таблица появилась в
hotels/0033.

Категория — тенантная сущность: «Люкс с террасой» одного отеля не должен ни
читаться, ни назначаться из другого. Сторож `test_rls_coverage` ловит пропуск,
поэтому политика заводится сразу, а не «когда-нибудь».
"""

from django.db import migrations

from apps.core import rls

TABLES = ["hotels_room_category"]


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0019_rls_scheduled_job"),
        ("hotels", "0033_room_fund_fields"),
    ]

    operations = [
        migrations.RunSQL(
            sql=rls.enable_sql(TABLES),
            reverse_sql=rls.disable_sql(TABLES),
        ),
    ]
