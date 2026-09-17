"""
Ответ отеля на отзыв. Хранится на самом отзыве — один на отзыв, — и помнит,
дошёл ли он до гостя: ответ мёртвой сессии только хранится, и персонал должен
видеть это, а не думать, что ответил.
"""

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("reviews", "0002_drop_low_rating_notified"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(model_name="review", name="reply_text", field=models.TextField(blank=True)),
        migrations.AddField(model_name="review", name="reply_at", field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(
            model_name="review",
            name="reply_by",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name="+", to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="review", name="reply_delivered", field=models.BooleanField(default=False)
        ),
    ]
