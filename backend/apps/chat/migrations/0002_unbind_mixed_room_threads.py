"""
Тред номера, в котором писали РАЗНЫЕ гости, отвязывается от гостя.

Пока тред жил при номере, он перепривязывался к каждой новой сессии, и
последний гость номера читал всю переписку прежних. Правка сервиса даёт новому
гостю новый тред, но уже смешанный тред остаётся привязанным к своей сессии —
её владелец продолжал бы видеть чужое. Такой тред отвязываем: сессия получит
свой, пустой, а переписка остаётся персоналу для разбора (не удаляется).

«Разные гости» — есть сообщение гостя, написанное не привязанной сессией
(в том числе без автора: так писал сев демо-данных).
"""

from django.db import migrations


def unbind(apps_registry, schema_editor):
    ChatThread = apps_registry.get_model("chat", "ChatThread")
    ChatMessage = apps_registry.get_model("chat", "ChatMessage")
    db = schema_editor.connection.alias
    mixed = []
    threads = ChatThread.objects.using(db).filter(guest_session__isnull=False)
    for thread_id, session_id in threads.values_list("pk", "guest_session_id").iterator():
        foreign = (
            ChatMessage.objects.using(db)
            .filter(thread_id=thread_id, author_type="guest")
            .exclude(author_id=session_id)
            .exists()
        )
        if foreign:
            mixed.append(thread_id)
    ChatThread.objects.using(db).filter(pk__in=mixed).update(guest_session=None)
    print(f"\n    тредов с перепиской разных гостей отвязано: {len(mixed)}")


class Migration(migrations.Migration):

    dependencies = [("chat", "0001_initial")]

    operations = [migrations.RunPython(unbind, migrations.RunPython.noop)]
