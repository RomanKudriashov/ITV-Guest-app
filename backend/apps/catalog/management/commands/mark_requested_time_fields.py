"""
Поставить отметку «время заказа» демо-полям уже заведённых отелей.

Отметка (`RequestField.sets_requested_time`, партия 22) появилась позже, чем
поля на стенде. Сид ставит её только новым полям: повторный сид по живому
отелю переписывает слишком многое — пароль владельца, категории номеров, фото
позиций, расписания, сборы, — и гнать его ради одного флажка нельзя. Эта
команда трогает ТОЛЬКО флажок:

  * только пары «позиция → поле» из `DEMO_REQUESTED_TIME_FIELDS`;
  * только поле типа «время»;
  * только если у позиции ещё нет ни одного отмеченного поля — решение
    администратора (отметил другое или ничего не отметил осознанно, и
    отметка уже стоит) сильнее демо-списка.

Идемпотентна: второй прогон ничего не меняет и говорит об этом.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError

from apps.catalog.models import RequestField
from apps.catalog.request_fields import DEMO_REQUESTED_TIME_FIELDS, FieldType
from apps.core.context import tenant_context
from apps.hotels.models import Hotel


class Command(BaseCommand):
    help = "Отметить демо-поля «время заказа» у уже заведённых отелей (только этот флажок)"

    def add_arguments(self, parser):
        parser.add_argument(
            "--subdomain",
            action="append",
            default=[],
            help="Отель по поддомену; можно несколько раз. Без него — все отели.",
        )
        parser.add_argument("--dry-run", action="store_true", help="Показать, ничего не меняя")

    def handle(self, *args, **options):
        hotels = Hotel.all_objects.all().order_by("subdomain")
        if options["subdomain"]:
            hotels = hotels.filter(subdomain__in=options["subdomain"])
            missing = set(options["subdomain"]) - set(hotels.values_list("subdomain", flat=True))
            if missing:
                raise CommandError(f"Нет отелей: {', '.join(sorted(missing))}")

        marked = kept = 0
        # ПО ОТЕЛЯМ, в контексте тенанта: строки закрыты RLS, и без контекста
        # база честно отдаёт пустоту — команда «успешно» не сделала бы ничего.
        for hotel in hotels:
            with tenant_context(hotel):
                for item_code, field_code in sorted(DEMO_REQUESTED_TIME_FIELDS):
                    fields = RequestField.objects.filter(item__code=item_code)
                    if not fields.exists():
                        continue
                    if fields.filter(sets_requested_time=True).exists():
                        kept += 1
                        continue
                    target = fields.filter(code=field_code, field_type=FieldType.TIME)
                    if not target.exists():
                        continue
                    if not options["dry_run"]:
                        target.update(sets_requested_time=True)
                    marked += 1
                    self.stdout.write(f"{hotel.subdomain}: {item_code}.{field_code}")

        verb = "было бы отмечено" if options["dry_run"] else "отмечено"
        self.stdout.write(
            self.style.SUCCESS(f"{verb}: {marked}; уже с отметкой, не тронуто: {kept}")
        )
