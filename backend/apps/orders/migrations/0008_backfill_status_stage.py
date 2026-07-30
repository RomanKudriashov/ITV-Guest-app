"""
Бэкфилл ступени существующим статусам (R3).

Отдельной миграцией от схемной 0007 намеренно. Postgres не даёт менять таблицу,
у которой в той же транзакции остались непроведённые триггерные события: UPDATE
рядом с ADD CONSTRAINT в одном шаге падал на «pending trigger events». Разделение
на «сначала схема, потом данные» — единственный способ, не отключая атомарность.

Ступень выводится из УЖЕ ИМЕЮЩИХСЯ флагов, а не из списка кодов: отель мог
переименовать статусы, и хардкод кодов сломал бы ему поток.
"""

from django.db import migrations


def set_stage_from_flags(apps, schema_editor):
    StatusDefinition = apps.get_model("orders", "StatusDefinition")
    # ОБЯЗАТЕЛЬНО тем же подключением, что и миграция: соединение по умолчанию —
    # это другая сессия Postgres, и она встала бы в очередь за блокировкой,
    # которую держит сама миграция.
    rows = StatusDefinition.objects.using(schema_editor.connection.alias)

    # Порядок = приоритет: отмена важнее терминальности, терминальность важнее
    # начального. Оставшееся — работа.
    rows.filter(is_cancelled=True).update(stage="cancelled")
    rows.filter(is_cancelled=False, is_terminal=True).update(stage="done")
    rows.filter(is_cancelled=False, is_terminal=False, is_initial=True).update(stage="new")
    rows.filter(is_cancelled=False, is_terminal=False, is_initial=False).update(stage="working")
    # «В пути» — единственная ступень готовности в демо-пресете; она есть не у
    # каждого отеля, поэтому обновляем по коду и только внутри board.
    rows.filter(flow="board", code="on_the_way").update(stage="ready")


def noop(apps, schema_editor):
    """Обратно ступень не нужна: колонку удаляет откат 0007."""


class Migration(migrations.Migration):

    dependencies = [
        ("orders", "0007_status_flow_and_stage"),
    ]

    operations = [
        migrations.RunPython(set_stage_from_flags, noop),
    ]
