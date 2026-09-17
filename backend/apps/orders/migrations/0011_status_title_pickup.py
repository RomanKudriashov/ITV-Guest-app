"""
Название статуса для выдачи: «Готово к выдаче» и «Выдано» вместо «В пути» и
«Доставлено» у заказа, который гость забирает сам.

Поле + заполнение у существующих отелей — по отелям с `tenant_context`: под
обычной ролью RLS отдаёт ноль строк. Названия берутся из того же справочника,
что заводит новые отели (`status_flows.PICKUP_TITLES`), число — в вывод.
"""

import apps.core.fields
from django.db import migrations

from apps.core.context import tenant_context


def fill_pickup_titles(apps, schema_editor):
    from apps.orders.services.status_flows import PICKUP_TITLES

    db = schema_editor.connection.alias
    Hotel = apps.get_model("hotels", "Hotel")
    StatusDefinition = apps.get_model("orders", "StatusDefinition")
    filled = 0
    for hotel in Hotel.objects.using(db).all():
        with tenant_context(hotel.pk):
            for (flow, code), title in PICKUP_TITLES.items():
                filled += StatusDefinition.objects.using(db).filter(
                    hotel_id=hotel.pk, flow=flow, code=code
                ).update(title_pickup=title)
    print(f"  названий для выдачи проставлено: {filled}")


def noop(apps, schema_editor):
    """Обратный ход: колонка уносится целиком."""


class Migration(migrations.Migration):

    dependencies = [
        ('orders', '0010_order_cancel_reason'),
        ('hotels', '0034_location_pickup_point'),
    ]

    operations = [
        migrations.AddField(
            model_name='statusdefinition',
            name='title_pickup',
            field=apps.core.fields.TranslatableField(),
        ),
        migrations.RunPython(fill_pickup_titles, noop),
    ]
