"""
Название отеля становится переводимым.

Гость с китайским интерфейсом видел в шапке «Отель „Кристалл“»: имя собственное
оставаться как есть и должно, а слово «Отель» — нет. Поле было обычным
CharField, то есть одним на все четыре языка.

ТРИ ШАГА, А НЕ ALTER FIELD. varchar → jsonb Postgres сам не приведёт, а
`AlterField` не умеет USING. Поэтому рядом заводится новое поле, содержимое
переносится, старое убирается, новое переименовывается на его место.

ПЕРЕНОС БЕЗ ПОТЕРЬ. Старое название кладётся в язык отеля по умолчанию, а не
в жёстко зашитый русский: у отеля с английским по умолчанию русского ключа
взяться неоткуда. Обратная миграция достаёт его же — данные ходят в обе
стороны, и откат не превращает название в пустоту.
"""

from django.db import migrations

import apps.core.fields


def to_translations(apps_registry, schema_editor):
    Hotel = apps_registry.get_model("hotels", "Hotel")
    # ЧЕРЕЗ СОЕДИНЕНИЕ САМОЙ МИГРАЦИИ, а не через роутер по умолчанию. Миграции
    # идут платформенной ролью и держат ACCESS EXCLUSIVE на таблице; запрос,
    # ушедший на другое соединение, встанет в очередь за этой же блокировкой и
    # будет ждать её вечно — миграция окажется заблокирована сама собой.
    db = schema_editor.connection.alias
    for hotel in Hotel.objects.using(db).all().iterator():
        language = (hotel.default_language or "ru").strip() or "ru"
        Hotel.objects.using(db).filter(pk=hotel.pk).update(
            name_translations={language: hotel.name} if hotel.name else {}
        )


def to_plain(apps_registry, schema_editor):
    Hotel = apps_registry.get_model("hotels", "Hotel")
    db = schema_editor.connection.alias
    for hotel in Hotel.objects.using(db).all().iterator():
        raw = hotel.name_translations or {}
        language = (hotel.default_language or "ru").strip() or "ru"
        # Язык отеля, иначе любое непустое значение: терять название при
        # откате нельзя, даже если конкретно этого языка в словаре нет.
        value = raw.get(language) or next((v for v in raw.values() if v), "")
        Hotel.objects.using(db).filter(pk=hotel.pk).update(name=value)


class Migration(migrations.Migration):

    dependencies = [("hotels", "0017_hotel_city")]

    operations = [
        migrations.AddField(
            model_name="hotel",
            name="name_translations",
            field=apps.core.fields.TranslatableField(),
        ),
        migrations.RunPython(to_translations, to_plain),
        migrations.RemoveField(model_name="hotel", name="name"),
        migrations.RenameField(
            model_name="hotel", old_name="name_translations", new_name="name"
        ),
    ]
