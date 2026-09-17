"""
`low_rating_notified` не читался ни разу. Однократность уведомления о низкой
оценке держит журнал событий (`dedupe_key` по событию шины) — второй флаг
был бы вторым источником правды, который никто не ставит.
"""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [("reviews", "0001_initial")]

    operations = [
        migrations.RemoveField(model_name="review", name="low_rating_notified"),
    ]
