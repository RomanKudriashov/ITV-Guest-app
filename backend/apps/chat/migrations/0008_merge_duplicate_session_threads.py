"""
Один тред на сессию гостя — дубли сливаются.

Первое открытие чата и подключение сокета одновременно спрашивали «найти или
создать» и оба создавали: у сессии оказывалось два треда, сокет гостя слушал
один, а сообщения уходили в другой — ответ ресепшена не приходил вживую.
Сливаем в самый ранний тред: сообщения переносятся, пустые дубли удаляются,
отметки времени пересчитываются. Ничего не теряется.
"""

from django.db import migrations
from django.db.models import Count, Max


def merge(apps_registry, schema_editor):
    ChatThread = apps_registry.get_model("chat", "ChatThread")
    ChatMessage = apps_registry.get_model("chat", "ChatMessage")
    db = schema_editor.connection.alias
    threads = ChatThread._base_manager.using(db)
    messages = ChatMessage._base_manager.using(db)
    duplicated = (
        threads.filter(guest_session__isnull=False)
        .values("guest_session")
        .annotate(n=Count("pk"))
        .filter(n__gt=1)
        .values_list("guest_session", flat=True)
    )
    merged = 0
    for session_id in list(duplicated):
        group = list(threads.filter(guest_session_id=session_id).order_by("created_at", "pk"))
        keeper, extra = group[0], group[1:]
        extra_ids = [t.pk for t in extra]
        messages.filter(thread_id__in=extra_ids).update(thread_id=keeper.pk)
        threads.filter(pk__in=extra_ids).delete()
        stamps = {}
        for field, side in (("last_guest_message_at", "guest"), ("last_staff_message_at", "staff")):
            stamps[field] = messages.filter(thread_id=keeper.pk, author_type=side).aggregate(at=Max("created_at"))["at"]
        stamps["last_message_at"] = messages.filter(thread_id=keeper.pk).aggregate(at=Max("created_at"))["at"]
        threads.filter(pk=keeper.pk).update(**stamps)
        merged += len(extra_ids)
    print(f"\n    дублей тредов слито: {merged}")


class Migration(migrations.Migration):

    dependencies = [("chat", "0007_thread_holder")]

    operations = [migrations.RunPython(merge, migrations.RunPython.noop)]
