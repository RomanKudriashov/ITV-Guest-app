"""
Переписка с гостями — на ресепшен.

Гость видит один чат, отвечает ресепшен. Существующие треды отеля (в
«Кристалле» все 16 стояли на консьерже: выбор брал любую точку вида
«ресепшен») перевешиваются на ресепшен по тому же правилу, что и сервис
(`chat.services.threads.reception_point`): точка с кодом `reception`, нет её —
первая по коду точка вида «ресепшен». Отель без ресепшена не трогаем.
Переписка не удаляется и не меняется.
"""

from django.db import migrations


def move(apps_registry, schema_editor):
    ExecutionPoint = apps_registry.get_model("hotels", "ExecutionPoint")
    ChatThread = apps_registry.get_model("chat", "ChatThread")
    db = schema_editor.connection.alias
    moved = 0
    hotel_ids = ChatThread._base_manager.using(db).values_list("hotel_id", flat=True).distinct()
    for hotel_id in list(hotel_ids):
        points = ExecutionPoint._base_manager.using(db).filter(
            hotel_id=hotel_id, is_active=True, deleted_at__isnull=True
        )
        reception = (
            points.filter(code="reception").first()
            or points.filter(kind="reception").order_by("code").first()
        )
        if reception is None:
            continue
        moved += (
            ChatThread._base_manager.using(db)
            .filter(hotel_id=hotel_id)
            .exclude(execution_point_id=reception.pk)
            .update(execution_point_id=reception.pk)
        )
    print(f"\n    тредов перевешено на ресепшен: {moved}")


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0003_drop_empty_threads"),
        ("hotels", "0035_review_low_threshold_two"),
    ]

    operations = [migrations.RunPython(move, migrations.RunPython.noop)]
