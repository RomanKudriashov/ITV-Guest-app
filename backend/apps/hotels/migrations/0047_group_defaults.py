"""Умолчания группы для новых отелей: правило и модули (партия 62-A2). Только схема."""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("hotels", "0046_groups_one_owner"),
    ]

    operations = [
        migrations.AddField(model_name="hotelgroup", name="auto_enabled", field=models.BooleanField(default=False)),
        migrations.AddField(model_name="hotelgroup", name="auto_modules", field=models.JSONField(blank=True, default=list)),
    ]
