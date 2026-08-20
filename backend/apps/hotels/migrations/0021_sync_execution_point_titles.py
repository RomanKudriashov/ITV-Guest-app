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

RLS. `Service` и `ExecutionPoint` — тенант-таблицы, и под обычной ролью без
выставленного тенанта запрос к ним возвращает НОЛЬ СТРОК, а не ошибку: миграция
отчиталась бы «OK», не тронув ничего. Поэтому обходим по отелям, выставляя
тенанта в сессии Postgres, — так работает и под платформенной ролью, и под
обычной. Ровно на этом первая редакция и попалась.
"""

from django.db import migrations

from apps.core.context import tenant_context


def sync_titles(apps, schema_editor):
    db = schema_editor.connection.alias
    Hotel = apps.get_model("hotels", "Hotel")
    Service = apps.get_model("hotels", "Service")

    for hotel in Hotel.objects.using(db).all():
        with tenant_context(hotel.pk):
            _sync_one_hotel(Service, db, hotel.pk)


def _sync_one_hotel(Service, db, hotel_id):
    for service in Service.objects.using(db).filter(hotel_id=hotel_id).select_related(
        "execution_point"
    ):
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
