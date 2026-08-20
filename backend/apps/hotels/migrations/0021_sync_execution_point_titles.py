"""
Сводим служебное имя исполнителя с гостевым именем заведения.

Переименование заведения не обновляло `ExecutionPoint.title`, и разъезд копился
молча: витрина показывала новое имя, а трекер, эскалации, привязки каналов,
слоты и аналитика — то, что было в момент создания. Само переименование
починено в `update_service`; здесь — уже накопленное.

Связь 1:1 (unique по execution_point), отдельного редактора у служебного имени
нет ни одного, заводится оно копией с гостевого — значит расхождение это ВСЕГДА
след бага, а не чьё-то решение, и затирать тут нечего.

Идемпотентно: второй прогон не найдёт расхождений. Обратный ход — noop:
восстанавливать разъехавшиеся имена не из чего, да и незачем.
"""

from django.db import migrations


def sync_titles(apps, schema_editor):
    db = schema_editor.connection.alias
    Service = apps.get_model("hotels", "Service")

    for service in Service.objects.using(db).select_related("execution_point"):
        point = service.execution_point
        wanted = dict(service.public_name or {})
        # Пустое гостевое имя не должно обнулять служебное: пусть лучше
        # останется старое, чем на трекере появится безымянная доска.
        if not wanted or (point.title or {}) == wanted:
            continue
        point.title = wanted
        point.save(update_fields=["title"])


class Migration(migrations.Migration):
    dependencies = [
        ("hotels", "0020_hotel_custom_domain_unique"),
    ]

    operations = [
        migrations.RunPython(sync_titles, migrations.RunPython.noop),
    ]
