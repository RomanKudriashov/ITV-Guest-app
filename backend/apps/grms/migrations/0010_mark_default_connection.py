"""Партия 65: прежнее (единственное) подключение отеля — «по умолчанию».

Отдельной миграцией: в одной транзакции со сменой схемы обновление строк
оставляет отложенные триггеры, и следующий ALTER TABLE падает
(«pending trigger events»).
"""

from django.db import migrations


def mark_default(apps, schema_editor):
    """Прежнее (единственное) подключение отеля — «по умолчанию»: номера без назначения идут через него."""
    from apps.core.context import tenant_context

    db = schema_editor.connection.alias
    Hotel = apps.get_model("hotels", "Hotel")
    ControlServer = apps.get_model("grms", "ControlServer")
    for hotel in Hotel.objects.using(db).all():
        with tenant_context(hotel.pk):
            first = ControlServer.objects.using(db).filter(deleted_at__isnull=True).order_by("created_at").first()
            if first is not None:
                ControlServer.objects.using(db).filter(pk=first.pk).update(is_default=True)


def unmark_default(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("grms", "0009_multi_connections"),
    ]

    operations = [
        migrations.RunPython(mark_default, unmark_default),
    ]
