"""
Группы — отели одного владельца (партия 62-A1).

1. Новые поля группы: описание, цвет-метка, порядок, родитель.
2. Группы-правила → обычные списки по составу НА МОМЕНТ ПЕРЕХОДА: правило
   пересчитывается тем же условием, что и раньше, и состав записывается
   строками членства.
3. Отель — максимум в одной группе: если отель оказался в нескольких,
   остаётся самое раннее членство, остальные снимаются (их число печатается).
4. `kind`, `mode`, `rule` уходят из модели.

На стенде перед миграцией (только чтение): 2 живые группы — `chk-list-205040`
(список, пустой) и `chk-rule-205040` (правило «происхождение = демо», состав
пустой); строк членства 0; областей сотрудников 0.
"""

from django.db import migrations, models
from django.db.models import Q, TextField
from django.db.models.functions import Cast


def rules_to_lists(apps, schema_editor):
    # ТОЛЬКО ЧЕРЕЗ ПОДКЛЮЧЕНИЕ МИГРАЦИИ. Стенд мигрирует `--database=platform`,
    # и эта же транзакция держит `hotels_group` после ALTER TABLE; запрос через
    # подключение по умолчанию ждал её блокировку, а она ждала его — выкатка
    # повисла (партия 62-A1). Каждый запрос ниже — `.using(db)`.
    db = schema_editor.connection.alias
    Group = apps.get_model("hotels", "HotelGroup")
    Member = apps.get_model("hotels", "HotelGroupMember")
    Hotel = apps.get_model("hotels", "Hotel")

    converted = 0
    for index, group in enumerate(Group.objects.using(db).filter(deleted_at__isnull=True).order_by("title")):
        group.sort_order = index + 1
        group.save(using=db, update_fields=["sort_order"])
        if group.mode != "rule":
            continue
        rule = group.rule or {}
        hotels = Hotel.objects.using(db).filter(deleted_at__isnull=True)
        if (rule.get("origin") or "").strip():
            hotels = hotels.filter(origin=rule["origin"].strip())
        if (rule.get("tariff") or "").strip():
            hotels = hotels.filter(tariff=rule["tariff"].strip())
        if (rule.get("city") or "").strip():
            hotels = hotels.annotate(_city=Cast("city", TextField())).filter(_city__icontains=rule["city"].strip())
        if (rule.get("language") or "").strip():
            hotels = hotels.filter(default_language=rule["language"].strip())
        for hotel_id in hotels.values_list("pk", flat=True):
            member, _ = Member.objects.using(db).get_or_create(group=group, hotel_id=hotel_id)
            if member.deleted_at is not None:
                member.deleted_at = None
                member.save(using=db, update_fields=["deleted_at"])
        converted += 1

    # Один владелец: оставляем самое раннее живое членство отеля.
    dropped = 0
    seen = set()
    for member in Member.objects.using(db).filter(deleted_at__isnull=True).order_by("hotel_id", "created_at"):
        if member.hotel_id in seen:
            member.delete(using=db)
            dropped += 1
        else:
            seen.add(member.hotel_id)
    print(f"\n  группы: правил переведено в списки — {converted}, лишних членств снято — {dropped}")


class Migration(migrations.Migration):
    dependencies = [
        ("hotels", "0045_module_intent_mass_off"),
    ]

    operations = [
        migrations.AddField(model_name="hotelgroup", name="description", field=models.TextField(blank=True)),
        migrations.AddField(
            model_name="hotelgroup",
            name="color",
            field=models.CharField(
                choices=[("accent", "Синий"), ("ok", "Зелёный"), ("warn", "Янтарный"), ("bad", "Красный"), ("gold", "Золотой"), ("info", "Голубой")],
                default="accent",
                max_length=16,
            ),
        ),
        migrations.AddField(model_name="hotelgroup", name="sort_order", field=models.PositiveIntegerField(default=0)),
        migrations.AddField(
            model_name="hotelgroup",
            name="parent",
            field=models.ForeignKey(blank=True, null=True, on_delete=models.deletion.SET_NULL, related_name="children", to="hotels.hotelgroup"),
        ),
        migrations.RunPython(rules_to_lists, migrations.RunPython.noop),
        migrations.RemoveField(model_name="hotelgroup", name="kind"),
        migrations.RemoveField(model_name="hotelgroup", name="mode"),
        migrations.RemoveField(model_name="hotelgroup", name="rule"),
        migrations.AlterModelOptions(name="hotelgroup", options={"ordering": ["sort_order", "title"]}),
        migrations.AddConstraint(
            model_name="hotelgroupmember",
            constraint=models.UniqueConstraint(condition=Q(deleted_at__isnull=True), fields=("hotel",), name="uniq_hotel_one_group"),
        ),
    ]
