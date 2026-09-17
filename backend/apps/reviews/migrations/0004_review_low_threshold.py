"""
Порог «низкая» — снимком на отзыве.

Настройка, по которой считают прошлое, фиксируется в момент события: иначе
смена порога отелем переписывает, какие отзывы были низкими. Старым отзывам —
порог их отеля на момент миграции (раньше не хранили).
"""

from django.db import migrations, models
from django.db.models import OuterRef, Subquery


def fill(apps_registry, schema_editor):
    Review = apps_registry.get_model("reviews", "Review")
    Hotel = apps_registry.get_model("hotels", "Hotel")
    db = schema_editor.connection.alias
    threshold = Hotel.objects.using(db).filter(pk=OuterRef("hotel_id")).values("review_low_threshold")[:1]
    filled = Review.objects.using(db).filter(low_threshold__isnull=True).update(low_threshold=Subquery(threshold))
    print(f"\n    порог «низкая» проставлен отзывам: {filled}")


class Migration(migrations.Migration):

    dependencies = [
        ("reviews", "0003_review_reply"),
        ("hotels", "0035_review_low_threshold_two"),
    ]

    operations = [
        migrations.AddField(
            model_name="review",
            name="low_threshold",
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.RunPython(fill, migrations.RunPython.noop),
    ]
