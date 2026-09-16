"""
Мягко удалённый номер перестаёт держать своё имя.

Было: `UniqueConstraint(hotel, number)` без условия. Удаление у нас мягкое
(`BaseModel.delete` проставляет `deleted_at`), строка остаётся — и номер 305,
удалённый год назад, навсегда занимал имя. На экране его нет, в списке нет, а
завести 305 заново нельзя: и код (`Room.all_objects`), и сама база отвечали
«уже существует».

Стало: ограничение действует только на живых строках. Удалённые номера могут
сколько угодно делить номер с живым — история заказов и сессий при этом
остаётся при своей строке и никуда не переезжает.

Данных миграция не трогает: меняется только ограничение.
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("hotels", "0031_room_sort_key")]

    operations = [
        migrations.RemoveConstraint(model_name="room", name="uniq_room_per_hotel"),
        migrations.AddConstraint(
            model_name="room",
            constraint=models.UniqueConstraint(
                condition=models.Q(deleted_at__isnull=True),
                fields=("hotel", "number"),
                name="uniq_room_per_hotel",
            ),
        ),
    ]
