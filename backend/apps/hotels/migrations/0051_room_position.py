"""Партия 63-1: позиция номера на этаже (стояк), заданная руками; пусто — по правилу отеля."""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("hotels", "0050_drop_tariffs_and_module_intent")]

    operations = [
        migrations.AddField(
            model_name="room",
            name="position",
            field=models.CharField(blank=True, max_length=16),
        ),
    ]
