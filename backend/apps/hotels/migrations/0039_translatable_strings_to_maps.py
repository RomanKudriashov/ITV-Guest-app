"""
Название и город строкой — в словарь переводов.

Переводимое поле хранит `{язык: текст}`, но у демо-отеля название лежало
простой строкой (след ранних переносов). Экран настроек главной читал строку,
отправлял её обратно — и сервер отвечал 422: сохранить настройки главной было
нельзя вовсе, включая город и погоду. Раскладываем строку по языку отеля.
"""

from django.db import migrations


def to_maps(apps_registry, schema_editor):
    Hotel = apps_registry.get_model("hotels", "Hotel")
    db = schema_editor.connection.alias
    fixed = 0
    for hotel in Hotel.objects.using(db).all().iterator():
        changes = {}
        for field in ("name", "city"):
            value = getattr(hotel, field, None)
            if isinstance(value, str) and value.strip():
                changes[field] = {(hotel.default_language or "en"): value.strip()}
            elif value is not None and not isinstance(value, dict):
                changes[field] = {}
        if changes:
            Hotel.objects.using(db).filter(pk=hotel.pk).update(**changes)
            fixed += 1
    print(f"\n    отелей с переводимым полем-строкой исправлено: {fixed}")


class Migration(migrations.Migration):

    dependencies = [("hotels", "0038_temperature_units")]

    operations = [migrations.RunPython(to_maps, migrations.RunPython.noop)]
