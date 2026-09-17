"""
Пустые треды — удаляются.

Их заводила главная витрины ради счётчика непрочитанных, по треду на каждую
сессию: на стенде 4075 тредов, сообщения — в 16. В пустом треде нечего
разбирать и нечего терять; персоналу он не показывается с волны 9.
"""

from django.db import migrations


def drop(apps_registry, schema_editor):
    ChatThread = apps_registry.get_model("chat", "ChatThread")
    ChatMessage = apps_registry.get_model("chat", "ChatMessage")
    db = schema_editor.connection.alias
    with_messages = ChatMessage._base_manager.using(db).values("thread_id")
    empty = ChatThread._base_manager.using(db).exclude(pk__in=with_messages)
    deleted, _ = empty.delete()
    print(f"\n    пустых тредов удалено: {deleted}")


class Migration(migrations.Migration):

    dependencies = [("chat", "0002_unbind_mixed_room_threads")]

    operations = [migrations.RunPython(drop, migrations.RunPython.noop)]
