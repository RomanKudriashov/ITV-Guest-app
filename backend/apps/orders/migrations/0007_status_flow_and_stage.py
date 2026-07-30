"""
Типизированные потоки статусов (R3).

Существующий пресет отеля становится потоком «board» — тем самым, по которому
кухня работала до R3. Поэтому бэкфилл здесь тривиален по построению: flow у
всех старых строк один, а ступень выводится из уже имеющихся флагов, а не из
списка кодов — отель мог переименовать статусы, и хардкод кодов сломал бы ему
поток.

Уникальность переезжает с (hotel, code) на (hotel, flow, code): `new` доски и
`new` заявок консьержа — разные строки.
"""

from django.db import migrations, models


def set_stage_from_flags(apps, schema_editor):
    StatusDefinition = apps.get_model("orders", "StatusDefinition")
    # Порядок проверок = приоритет: отмена важнее терминальности, терминальность
    # важнее начального. Оставшееся — работа.
    StatusDefinition.objects.filter(is_cancelled=True).update(stage="cancelled")
    StatusDefinition.objects.filter(is_cancelled=False, is_terminal=True).update(stage="done")
    StatusDefinition.objects.filter(
        is_cancelled=False, is_terminal=False, is_initial=True
    ).update(stage="new")
    StatusDefinition.objects.filter(
        is_cancelled=False, is_terminal=False, is_initial=False
    ).update(stage="working")
    # «В пути» — единственная ступень готовности в демо-пресете; она есть не у
    # каждого отеля, поэтому обновляем по коду и только внутри board.
    StatusDefinition.objects.filter(flow="board", code="on_the_way").update(stage="ready")


def noop(apps, schema_editor):
    """Обратно ступень не нужна: колонки удаляются целиком."""


class Migration(migrations.Migration):

    dependencies = [
        ("orders", "0006_order_parent"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="statusdefinition",
            name="uniq_status_code_per_hotel",
        ),
        migrations.AddField(
            model_name="statusdefinition",
            name="flow",
            field=models.SlugField(default="board", max_length=32),
        ),
        migrations.AddField(
            model_name="statusdefinition",
            name="stage",
            field=models.SlugField(default="new", max_length=32),
        ),
        migrations.RunPython(set_stage_from_flags, noop),
        migrations.AddConstraint(
            model_name="statusdefinition",
            constraint=models.UniqueConstraint(
                fields=("hotel", "flow", "code"), name="uniq_status_code_per_flow"
            ),
        ),
    ]
