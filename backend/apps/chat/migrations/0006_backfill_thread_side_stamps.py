"""Старым тредам — отметки последнего сообщения гостя и персонала по их сообщениям."""

from django.db import migrations


def backfill(apps_registry, schema_editor):
    from django.db.models import Max, OuterRef, Subquery

    ChatThread = apps_registry.get_model("chat", "ChatThread")
    ChatMessage = apps_registry.get_model("chat", "ChatMessage")
    db = schema_editor.connection.alias
    for side, field in (("guest", "last_guest_message_at"), ("staff", "last_staff_message_at")):
        last = (
            ChatMessage._base_manager.using(db)
            .filter(thread_id=OuterRef("pk"), author_type=side)
            .values("thread_id")
            .annotate(at=Max("created_at"))
            .values("at")[:1]
        )
        ChatThread._base_manager.using(db).update(**{field: Subquery(last)})


class Migration(migrations.Migration):

    dependencies = [("chat", "0005_thread_side_stamps")]

    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
