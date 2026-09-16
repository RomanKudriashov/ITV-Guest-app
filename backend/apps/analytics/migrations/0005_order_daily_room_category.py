"""
Разрез суточной витрины заказов по КАТЕГОРИИ НОМЕРА.

Значение пишется снимком в момент заказа (`dimensions.room_category_for_order`),
а не резолвится по комнате: иначе перевод комнаты из «Стандарта» в «Делюкс»
переписал бы прошлые отчёты задним числом.

БЭКФИЛЛА НЕТ, И ЭТО РЕШЕНИЕ. Прошлые строки витрины получают пустой ключ —
«без категории». Восстановить их настоящую категорию нечем: на момент заказа её
не существовало, а нынешняя категория комнаты — это НЕ то, что было продано
тогда. Заполнить её сейчас значило бы выдать сегодняшнюю догадку за историю;
экран вместо этого прямо говорит, что заказы до появления разреза категорию не
несут.

Старое ограничение уникальности снимается и ставится заново с новой колонкой:
без этого две строки, различающиеся только категорией, схлопнулись бы в одну.
"""


from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('analytics', '0004_orderdaily_delivery_minor_and_more'),
        ('hotels', '0033_room_fund_fields'),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name='orderdaily',
            name='uniq_order_daily',
        ),
        migrations.AddField(
            model_name='orderdaily',
            name='room_category_key',
            field=models.CharField(blank=True, max_length=64),
        ),
        migrations.AddConstraint(
            model_name='orderdaily',
            constraint=models.UniqueConstraint(fields=('hotel', 'business_date', 'offering_type', 'point_key', 'location_key', 'entry_method', 'device', 'language', 'room_category_key'), name='uniq_order_daily'),
        ),
    ]
