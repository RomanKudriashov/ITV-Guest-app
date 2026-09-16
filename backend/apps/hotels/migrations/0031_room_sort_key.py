"""
Человеческий порядок номеров: служебный ключ сортировки.

Порядок в списке номеров был лексикографическим (`ordering = ["number"]` по
CharField), то есть `12` после `101`, а `99` в самом конце. На демо-стенде это
незаметно — там номера одной ширины, и порядок случайно совпадает с верным;
дефект вылезает на первом же фонде, где есть 99 и 100.

Ключ считает `natural_number_key` — единственное место правила. Каждая группа
цифр дополняется нулями до восьми разрядов, буквы приводятся к нижнему
регистру.

RLS. `Room` — тенантная таблица: под обычной ролью без выставленного тенанта
запрос вернёт НОЛЬ СТРОК, а не ошибку, и «успешная» миграция не тронет ничего.
Обходим по отелям с `tenant_context` — как в hotels.0021, hotels.0023 и
grms.0006.

ПРОВЕРЯЕМ, А НЕ НАДЕЕМСЯ: после записи перечитываем и требуем совпадения с
пересчитанным ключом.
"""

from django.db import migrations, models

from apps.core.context import tenant_context
from apps.hotels.models.room import natural_number_key


def backfill(apps, schema_editor):
    db = schema_editor.connection.alias
    Hotel = apps.get_model("hotels", "Hotel")
    Room = apps.get_model("hotels", "Room")

    touched = 0
    for hotel in Hotel.objects.using(db).all():
        with tenant_context(hotel.pk):
            # all_objects исторической модели нет — фильтруем по отелю сами,
            # ВКЛЮЧАЯ мягко удалённые: они тоже участвуют в сортировке, когда
            # их показывают, и ключ у них должен быть.
            for room in Room.objects.using(db).filter(hotel_id=hotel.pk):
                room.sort_key = natural_number_key(room.number)
                room.save(update_fields=["sort_key"])
                touched += 1

    for hotel in Hotel.objects.using(db).all():
        with tenant_context(hotel.pk):
            for room in Room.objects.using(db).filter(hotel_id=hotel.pk):
                expected = natural_number_key(room.number)
                if room.sort_key != expected:
                    raise RuntimeError(
                        f"номер {room.number}: ключ «{room.sort_key}» вместо "
                        f"«{expected}» — бэкфилл не доехал"
                    )
    print(f"  ключ сортировки проставлен: {touched} номеров")


def noop(apps, schema_editor):
    """Обратный ход: колонка уносится целиком, восстанавливать нечего."""


class Migration(migrations.Migration):
    dependencies = [("hotels", "0030_brand_versions")]

    operations = [
        migrations.AddField(
            model_name="room",
            name="sort_key",
            field=models.CharField(blank=True, db_index=True, editable=False, max_length=320),
        ),
        migrations.AlterModelOptions(
            name="room",
            options={"ordering": ["sort_key", "number"]},
        ),
        migrations.RunPython(backfill, noop),
    ]
