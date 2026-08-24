"""
Уровень плана: записанное решение вместо догадки по кадрам.

Вид экрана номера выводился из содержимого `plan`: пара кадров — полный план,
один — простой, пусто — плашки. Догадка того же класса, что мы уже дважды
чинили (порог SLA в hotels.0023, `source` у модулей в hotels.0022): она путает
«мы продали простой план» с «полный ещё не доделан», и снятый по ошибке кадр
молча понижает купленную услугу.

БЭКФИЛЛ. «Что стоит сейчас — то и есть выбор», как с модулями и порогом:

    есть asset_id и asset_off_id  → full    (пара кадров, полный план)
    есть только asset_id          → simple  (один кадр)
    кадров нет                    → tiles   (экран работает списком)

Ни один тип не меняет вида: миграция записывает то, что он и так показывал.
Дальше поле живёт само — снятие кадров уровня не трогает.

ПРОВЕРЯЕМ, А НЕ НАДЕЕМСЯ. Шаг данных пересчитывает ожидаемый уровень по тем же
правилам и падает при расхождении: «успешная» миграция, не тронувшая ни строки,
у нас уже была.

RLS. `RoomType` — тенантная таблица: под обычной ролью без выставленного
тенанта запрос вернёт НОЛЬ СТРОК, а не ошибку. Обходим по отелям, выставляя
тенанта, — как в hotels.0021 и hotels.0023.
"""

from django.db import migrations, models

from apps.core.context import tenant_context


def level_for(plan) -> str:
    """Уровень, который тип показывал ДО миграции. Единственное место правила."""
    plan = plan if isinstance(plan, dict) else {}
    if not plan.get("asset_id"):
        return "tiles"
    return "full" if plan.get("asset_off_id") else "simple"


def backfill(apps, schema_editor):
    db = schema_editor.connection.alias
    Hotel = apps.get_model("hotels", "Hotel")
    RoomType = apps.get_model("grms", "RoomType")

    touched = 0
    for hotel in Hotel.objects.using(db).all():
        with tenant_context(hotel.pk):
            for room_type in RoomType.objects.using(db).filter(hotel_id=hotel.pk):
                room_type.plan_level = level_for(room_type.plan)
                room_type.save(update_fields=["plan_level"])
                touched += 1

    # Сверка: перечитываем и требуем, чтобы записанное совпало с ожидаемым.
    for hotel in Hotel.objects.using(db).all():
        with tenant_context(hotel.pk):
            for room_type in RoomType.objects.using(db).filter(hotel_id=hotel.pk):
                expected = level_for(room_type.plan)
                if room_type.plan_level != expected:
                    raise RuntimeError(
                        f"тип {room_type.code}: уровень «{room_type.plan_level}» "
                        f"вместо ожидаемого «{expected}» — бэкфилл не доехал"
                    )
    print(f"  уровень плана проставлен: {touched} типов")


def noop(apps, schema_editor):
    """Обратный ход: поле уносится целиком, восстанавливать нечего."""


class Migration(migrations.Migration):
    dependencies = [
        ("grms", "0005_controlelement_hint"),
        ("hotels", "0023_execution_point_sla_nullable"),
    ]

    operations = [
        migrations.AddField(
            model_name="roomtype",
            name="plan_level",
            field=models.CharField(
                choices=[
                    ("tiles", "Плашки"),
                    ("simple", "Простой план"),
                    ("full", "Полный (парные кадры)"),
                ],
                default="tiles",
                max_length=16,
            ),
        ),
        migrations.RunPython(backfill, noop),
    ]
