"""
Пульс службы расписания: сколько ждёт впереди и разбивка по видам заданий —
у машины появился второй потребитель (ступени эскалации).
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0021_rls_notification_events'),
    ]

    operations = [
        migrations.AddField(
            model_name='schedulerheartbeat',
            name='by_kind',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name='schedulerheartbeat',
            name='pending_count',
            field=models.PositiveIntegerField(default=0),
        ),
    ]
