"""
Рамка кадра снята (партия 58в): после 58а варианты режутся из целого оригинала,
фокус уже перенесён из рамки миграцией 0007, редактор ставит точку главного.
Поля `crop` и `crop_ratio` не читает и не пишет никто.
"""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("media", "0008_variant_quality"),
    ]

    operations = [
        migrations.RemoveField(model_name="mediaasset", name="crop"),
        migrations.RemoveField(model_name="mediaasset", name="crop_ratio"),
    ]
