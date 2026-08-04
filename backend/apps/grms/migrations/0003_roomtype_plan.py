"""
Геометрия плана-двойника на типе номера.

Поле, а не таблица: разметка принадлежит типу целиком и уезжает в снимок
вместе с элементами. Отдельная таблица развела бы откат конфигурации и откат
разметки — вернулись бы старые элементы с новой геометрией.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('grms', '0002_roompin'),
    ]

    operations = [
        migrations.AddField(
            model_name='roomtype',
            name='plan',
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
