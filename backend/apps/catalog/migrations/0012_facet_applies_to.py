"""
Область применения записи справочника: аллергены и маркеры.

ПУСТОЙ СПИСОК — ЭТО «КАК У СПРАВОЧНИКА», А НЕ «НИГДЕ». Поэтому умолчание
`list` и никакого заполнения существующих строк не требуется: все записи,
которых отель не трогал, ведут себя ровно так же, как до миграции. Данные,
проставленные позициям, эта миграция не касается вовсе — сужение области
показа не должно стирать того, что уже отмечено руками.

ОТКАТ ПОЛНЫЙ: колонки удаляются вместе с содержимым, и терять нечего —
сужения до этой миграции не существовало.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("catalog", "0011_search_indexes"),
    ]

    operations = [
        migrations.AddField(
            model_name="allergen",
            name="applies_to",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="dietarymarker",
            name="applies_to",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
