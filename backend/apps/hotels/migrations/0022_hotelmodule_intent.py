"""
`source` (вычисляемая пометка) → `intent` (записанное решение человека).

`source` хранился, но данными не был: он пересчитывался при каждой записи по
формуле «override, если включено и тариф не даёт». Из-за неё выключенный модуль
ВСЕГДА получал «по тарифу», и «мы это выключили» было неотличимо от «тариф
этого не даёт».

БЭКФИЛЛ: принимаем «включено сейчас = намерение», и так, чтобы пересчёт по
новой формуле воспроизвёл сегодняшнюю картину без единого изменения:

  включено  + тариф даёт     → ""     (не трогали, просто следует за тарифом)
  включено  + тариф не даёт  → "on"   (иначе оно бы не было включено)
  выключено + тариф даёт     → "off"  (тариф давал, значит гасили руками)
  выключено + тариф не даёт  → ""     (не трогали)

`is_enabled` при этом НЕ пересчитывается: миграция меняет объяснение, а не
поведение. Пересчёт наступает при первой же смене тарифа — там, где ему и место.

Обратный ход восстанавливает `source` по той же формуле, что его и считала.
"""

from django.db import migrations, models


def backfill(apps, schema_editor):
    db = schema_editor.connection.alias
    HotelModule = apps.get_model("hotels", "HotelModule")
    Hotel = apps.get_model("hotels", "Hotel")

    from apps.hotels.services import tariffs

    grants = {
        hotel.pk: set(tariffs.modules_for(hotel.tariff)) for hotel in Hotel.objects.using(db).all()
    }
    for module in HotelModule.objects.using(db).all():
        granted = module.code in grants.get(module.hotel_id, set())
        if module.is_enabled:
            module.intent = "" if granted else "on"
        else:
            module.intent = "off" if granted else ""
        module.save(update_fields=["intent"])


def restore_source(apps, schema_editor):
    db = schema_editor.connection.alias
    HotelModule = apps.get_model("hotels", "HotelModule")
    Hotel = apps.get_model("hotels", "Hotel")

    from apps.hotels.services import tariffs

    grants = {
        hotel.pk: set(tariffs.modules_for(hotel.tariff)) for hotel in Hotel.objects.using(db).all()
    }
    for module in HotelModule.objects.using(db).all():
        granted = module.code in grants.get(module.hotel_id, set())
        module.source = "override" if module.is_enabled and not granted else "tariff"
        module.save(update_fields=["source"])


class Migration(migrations.Migration):
    dependencies = [
        ("hotels", "0021_sync_execution_point_titles"),
    ]

    operations = [
        migrations.AddField(
            model_name="hotelmodule",
            name="intent",
            field=models.CharField(
                blank=True,
                choices=[("", "Не трогали"), ("on", "Включено вручную"), ("off", "Выключено вручную")],
                default="",
                max_length=8,
            ),
        ),
        migrations.RunPython(backfill, restore_source),
        migrations.RemoveField(model_name="hotelmodule", name="source"),
    ]
