"""
Порог просрочки: хранимое НАМЕРЕНИЕ вместо догадки по умолчанию.

У `sla_minutes` было значение по умолчанию (20) и не было NULL. Из-за этого
«оператор выбрал двадцать минут» и «поле никто не трогал» выглядели одинаково,
а коду нужно было их различать: у заявок консьержа свой порог — четыре часа, и
двадцать минут кухни красили бы просрочкой вообще всё.

Прежний код принимал модельное умолчание за «не трогали» — и ошибался ровно у
тех, кто осознанно выбрал двадцать. Тот же класс дефекта чинили у модулей
(0022): вычисляемая пометка вместо записанного решения.

БЭКФИЛЛ. Принимаем «то, что стоит сейчас, и есть выбор» — как с модулями.
Точки не переезжают на NULL: сегодняшние числа стояли на экранах и в расчётах,
и обнулить их значило бы поменять поведение под видом смены схемы. NULL
появляется только у тех, кого заведут после этой миграции.

Обратный ход возвращает NOT NULL с прежним умолчанием: пустым точкам
проставляется 20 — то самое число, которое они и показывали бы.

RLS. `ExecutionPoint` — тенантная таблица: под обычной ролью без выставленного
тенанта запрос вернёт НОЛЬ СТРОК, а не ошибку, и миграция отчитается «OK», не
тронув ничего. Обходим по отелям, выставляя тенанта, — как в 0021.
"""

from django.db import migrations, models

from apps.core.context import tenant_context

# Прежнее умолчание поля. Выписано здесь явно: после правки модели спросить его
# у модели уже нельзя, а обратный ход обязан вернуть ровно его.
FORMER_DEFAULT = 20


def keep_current_values_as_choices(apps, schema_editor):
    """
    Ничего не переносим — и это осознанно.

    Смысл шага в том, что после смены схемы все существующие строки ОСТАЮТСЯ со
    своими числами, то есть трактуются как явный выбор. Проверяем это фактом:
    молча положиться на поведение ALTER COLUMN нельзя, а «успешная» миграция,
    не тронувшая ни строки из-за RLS, у нас уже была.
    """
    db = schema_editor.connection.alias
    Hotel = apps.get_model("hotels", "Hotel")
    ExecutionPoint = apps.get_model("hotels", "ExecutionPoint")

    emptied = 0
    for hotel in Hotel.objects.using(db).all():
        with tenant_context(hotel.pk):
            emptied += (
                ExecutionPoint.objects.using(db)
                .filter(hotel_id=hotel.pk, sla_minutes__isnull=True)
                .count()
            )
    if emptied:
        raise RuntimeError(
            f"после смены схемы {emptied} точек остались без порога — "
            "существующие значения обязаны сохраниться как явный выбор"
        )


def fill_back(apps, schema_editor):
    """Обратный ход: пустым точкам — прежнее умолчание, иначе NOT NULL не встанет."""
    db = schema_editor.connection.alias
    Hotel = apps.get_model("hotels", "Hotel")
    ExecutionPoint = apps.get_model("hotels", "ExecutionPoint")

    for hotel in Hotel.objects.using(db).all():
        with tenant_context(hotel.pk):
            ExecutionPoint.objects.using(db).filter(
                hotel_id=hotel.pk, sla_minutes__isnull=True
            ).update(sla_minutes=FORMER_DEFAULT)


class Migration(migrations.Migration):
    dependencies = [
        ("hotels", "0022_hotelmodule_intent"),
    ]

    operations = [
        migrations.AlterField(
            model_name="executionpoint",
            name="sla_minutes",
            field=models.PositiveSmallIntegerField(blank=True, default=None, null=True),
        ),
        migrations.RunPython(keep_current_values_as_choices, fill_back),
    ]
