"""
Бэкфилл модели сервиса.

На каждый существующий ExecutionPoint заводим свой Service (1:1): переносим
гостевую идентичность (public_name/tagline/is_guest_facing/image), венью-часы
(schedule) и минимум заказа (min_order_minor); тип выводим из kind. Затем
привязываем Category.service по маршруту (Route.execution_point → его Service).

Историч. модели, всё через .using(db) и get_or_create — идемпотентно. На
стенде/проде гоняет платформенная роль (migrate --database=platform, BYPASSRLS);
в тестах таблицы на момент миграции пусты, цикл ничего не трогает — сид создаёт
сервисы позже уже в новой форме. Обратный ход — noop (дроп таблиц откатит сам
CreateModel).
"""

from django.db import migrations

# Род исполнителя → тип-шаблон сервиса. Держите в синхроне с seed/provisioning.
_KIND_TO_TYPE = {
    "kitchen": "restaurant",
    "bar": "bar",
    "spa": "spa",
    "housekeeping": "housekeeping",
    "reception": "concierge",
    "other": "custom",
}


def backfill(apps, schema_editor):
    db = schema_editor.connection.alias
    ExecutionPoint = apps.get_model("hotels", "ExecutionPoint")
    Service = apps.get_model("hotels", "Service")
    Category = apps.get_model("catalog", "Category")
    Route = apps.get_model("catalog", "Route")

    for ep in ExecutionPoint.objects.using(db).all():
        Service.objects.using(db).get_or_create(
            hotel_id=ep.hotel_id,
            execution_point_id=ep.id,
            defaults={
                "code": ep.code,
                "type": _KIND_TO_TYPE.get(ep.kind, "custom"),
                "public_name": ep.public_name or {},
                "tagline": ep.tagline or {},
                "is_guest_facing": ep.is_guest_facing,
                "image_id": ep.image_id,
                "schedule_id": ep.schedule_id,
                "is_active": ep.is_active,
                "min_order_minor": ep.min_order_minor,
            },
        )

    services_by_ep = {
        service.execution_point_id: service.id
        for service in Service.objects.using(db).all()
    }
    for category in Category.objects.using(db).all():
        if category.service_id is not None:
            continue
        route = (
            Route.objects.using(db)
            .filter(category_id=category.id, is_active=True)
            .order_by("priority")
            .first()
        )
        if route is None:
            continue
        service_id = services_by_ep.get(route.execution_point_id)
        if service_id is not None:
            Category.objects.using(db).filter(id=category.id).update(service_id=service_id)


class Migration(migrations.Migration):
    dependencies = [
        ("hotels", "0010_service_hotelmodule"),
        ("catalog", "0009_category_service"),
        ("core", "0011_rls_service_modules"),
    ]

    operations = [
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
