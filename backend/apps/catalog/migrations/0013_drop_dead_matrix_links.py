"""
Мёртвые связки матрицы «категория × локация».

Удаление локации и категории мягкое, а связки матрицы при этом оставались
жить. На стенде так накопилось 129 связок «Напитки × Спа-NNNNNN» — по одной
на прогон, который заводил и удалял локацию. Живой логики они не несут, а
любому, кто посчитает матрицу, врут: «90 связок из 112 — только самовывоз»
оказались именно ими.

Удаляем жёстко: у связки нет истории, а мягко-удалённая строка блокировала
бы уникальный индекс при повторном включении. Утечка закрыта в сервисах
удаления (`delete_location`, `delete_category`).

По отелям с `tenant_context`: под обычной ролью RLS отдаёт ноль строк, и
миграция тихо не сделала бы ничего. Число удалённых печатается.
"""

from django.db import migrations
from django.db.models import Q

from apps.core.context import tenant_context


def drop_dead_links(apps, schema_editor):
    db = schema_editor.connection.alias
    Hotel = apps.get_model("hotels", "Hotel")
    ServiceLocation = apps.get_model("catalog", "ServiceLocation")

    dropped = 0
    for hotel in Hotel.objects.using(db).all():
        with tenant_context(hotel.pk):
            dead = ServiceLocation.objects.using(db).filter(hotel_id=hotel.pk).filter(
                Q(location__deleted_at__isnull=False) | Q(category__deleted_at__isnull=False)
            )
            dropped += dead.count()
            dead.delete()
    print(f"  мёртвых связок матрицы удалено: {dropped}")


def noop(apps, schema_editor):
    """Обратного хода нет: связки мёртвых локаций восстанавливать незачем."""


class Migration(migrations.Migration):
    dependencies = [
        ("catalog", "0012_facet_applies_to"),
        ("hotels", "0033_room_fund_fields"),
    ]

    operations = [migrations.RunPython(drop_dead_links, noop)]
