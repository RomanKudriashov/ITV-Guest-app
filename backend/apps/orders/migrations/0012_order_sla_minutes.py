"""
Порог просрочки — снимком в заказе.

Старым заказам ставим порог их точки НА МОМЕНТ МИГРАЦИИ: раньше порог не
хранился, и честнее значения нет. С этой миграции смена настройки точки
прошлое не переписывает.

Порог считается тем же правилом, что в бою (`effective_sla_minutes`): своя
копия здесь разошлась бы с доской молча. Правилу нужны только поля точки и
её сервисы — историческая модель их даёт, а живая сломала бы свежую
установку, как только точка получит новый столбец.
"""

from django.db import migrations, models


def fill(apps_registry, schema_editor):
    from apps.orders.services.tracker_types import effective_sla_minutes

    ExecutionPoint = apps_registry.get_model("hotels", "ExecutionPoint")
    Order = apps_registry.get_model("orders", "Order")
    db = schema_editor.connection.alias
    filled = 0
    points = ExecutionPoint._base_manager.using(db).prefetch_related("services")
    for point in points.iterator(chunk_size=200):
        filled += (
            Order.objects.using(db)
            .filter(execution_point_id=point.pk, sla_minutes__isnull=True)
            .update(sla_minutes=effective_sla_minutes(point))
        )
    print(f"\n    порог просрочки проставлен заказам: {filled}")


class Migration(migrations.Migration):

    dependencies = [
        ("orders", "0011_status_title_pickup"),
        ("hotels", "0035_review_low_threshold_two"),
    ]

    operations = [
        migrations.AddField(
            model_name="order",
            name="sla_minutes",
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.RunPython(fill, migrations.RunPython.noop),
    ]
