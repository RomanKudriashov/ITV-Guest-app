"""
Низкая оценка — «две звезды и ниже», как решил заказчик. Заводское значение
было 3 и расходилось с его решением.

Переводим только отели, стоящие на заводской тройке: своего порога ни один
не выбирал (замер 17.09.2026 — все 28 на 3). Отель, выставивший порог сам,
не трогаем. Откат возвращает двойки в тройки — различить «выбрал 2» и
«переведён» уже нечем, и откат честно об этом не заботится.
"""

from django.db import migrations, models


def to_two(apps_registry, schema_editor):
    Hotel = apps_registry.get_model("hotels", "Hotel")
    # Соединение самой миграции — см. 0018: иначе миграция ждёт сама себя.
    db = schema_editor.connection.alias
    moved = Hotel.objects.using(db).filter(review_low_threshold=3).update(review_low_threshold=2)
    print(f"\n    порог низкой оценки переведён на 2: {moved}")


def to_three(apps_registry, schema_editor):
    Hotel = apps_registry.get_model("hotels", "Hotel")
    db = schema_editor.connection.alias
    Hotel.objects.using(db).filter(review_low_threshold=2).update(review_low_threshold=3)


class Migration(migrations.Migration):

    dependencies = [("hotels", "0034_location_pickup_point")]

    operations = [
        migrations.AlterField(
            model_name="hotel",
            name="review_low_threshold",
            field=models.PositiveSmallIntegerField(default=2),
        ),
        migrations.RunPython(to_two, to_three),
    ]
