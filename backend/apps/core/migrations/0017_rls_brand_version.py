"""
RLS для версий и черновиков оформления.

Отдельной миграцией, а не правкой прежних: политику таблице ставит миграция,
СЛЕДУЮЩАЯ за её созданием (`apps/core/rls.py`), а таблица появилась в
hotels/0030.

ЗАЧЕМ ЭТО ЗДЕСЬ ВООБЩЕ. Черновик оформления — не «служебная запись»: в нём
лежит будущий вид витрины отеля, а в истории — все прежние. Утечка через
дырявый скоуп означала бы, что один отель читает и откатывает оформление
другого. Сторож `test_rls_coverage` поймал пропуск в первом же полном прогоне —
поэтому политика появилась не «когда-нибудь», а сразу.
"""

from django.db import migrations

from apps.core import rls

TABLES = ["hotels_brand_version"]


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0016_rls_staff_session"),
        ("hotels", "0030_brand_versions"),
    ]

    operations = [
        migrations.RunSQL(
            sql=rls.enable_sql(TABLES),
            reverse_sql=rls.disable_sql(TABLES),
        ),
    ]
