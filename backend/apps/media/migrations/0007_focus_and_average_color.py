"""
Точка фокуса вместо вырезанного кадра (партия 58а).

Фокус = центр нынешней рамки (`crop`), нет рамки — центр кадра. Рамка остаётся
на релиз: старый редактор её переоткрывает, а варианты по ней больше не режутся.
Средний цвет заполнит нарезка (новые загрузки и `rerender_media`).

Под платформенной ролью (`migrate --database=platform`): медиа закрыты RLS, и
под обычной ролью миграция «успешно» обошла бы ноль строк.
"""

from django.db import migrations, models


def _center(crop):
    if not crop:
        return {"x": 0.5, "y": 0.5}
    try:
        x = min(max(float(crop.get("x", 0.0)), 0.0), 1.0)
        y = min(max(float(crop.get("y", 0.0)), 0.0), 1.0)
        w = min(max(float(crop.get("w", 1.0)), 0.0), 1.0 - x)
        h = min(max(float(crop.get("h", 1.0)), 0.0), 1.0 - y)
    except (TypeError, ValueError, AttributeError):
        return {"x": 0.5, "y": 0.5}
    return {"x": round(x + w / 2, 4), "y": round(y + h / 2, 4)}


def fill(apps_registry, schema_editor):
    MediaAsset = apps_registry.get_model("media", "MediaAsset")
    db = schema_editor.connection.alias
    total = MediaAsset.objects.using(db).count()
    framed = 0
    MediaAsset.objects.using(db).filter(crop__isnull=True).update(focus={"x": 0.5, "y": 0.5})
    for asset in MediaAsset.objects.using(db).filter(crop__isnull=False).only("id", "crop"):
        asset.focus = _center(asset.crop)
        asset.save(update_fields=["focus"])
        framed += 1
    print(f"\n    фокус проставлен: {total} ассетов, из рамки — {framed}")


class Migration(migrations.Migration):

    dependencies = [
        ("media", "0006_alter_mediaasset_kind"),
    ]

    operations = [
        migrations.AddField(
            model_name="mediaasset",
            name="average_color",
            field=models.CharField(blank=True, max_length=7),
        ),
        migrations.AddField(
            model_name="mediaasset",
            name="focus",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.RunPython(fill, migrations.RunPython.noop),
    ]
