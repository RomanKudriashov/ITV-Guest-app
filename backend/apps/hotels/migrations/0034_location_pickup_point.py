"""
Третий вид локации — точка выдачи (стойка бара, окно кухни): гость забирает
заказ сам. Меняется только список значений; данных не переносим.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hotels', '0033_room_fund_fields'),
    ]

    operations = [
        migrations.AlterField(
            model_name='location',
            name='kind',
            field=models.CharField(choices=[('in_room', 'В номер'), ('common_point', 'Общая точка'), ('pickup_point', 'Точка выдачи')], default='in_room', max_length=32),
        ),
    ]
