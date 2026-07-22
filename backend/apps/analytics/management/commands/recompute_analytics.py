"""
Пересчёт аналитики отеля.

    python manage.py recompute_analytics --hotel crystal
    python manage.py recompute_analytics --hotel crystal --from-orders

Без --from-orders пересчитывает роллапы из журнала (быстрая проверка/починка).
С --from-orders сначала восстанавливает журнал из живых заказов (история).
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError

from apps.analytics.recompute import rebuild_raw_from_orders, recompute_aggregates
from apps.hotels.models import Hotel


class Command(BaseCommand):
    help = "Пересчитать аналитические агрегаты из журнала (или из заказов)."

    def add_arguments(self, parser):
        parser.add_argument("--hotel", required=True, help="Поддомен отеля")
        parser.add_argument(
            "--from-orders",
            action="store_true",
            help="Сначала восстановить журнал из живых заказов/сессий/отзывов",
        )

    def handle(self, *args, **options):
        hotel = Hotel.objects.filter(subdomain=options["hotel"]).first()
        if hotel is None:
            raise CommandError(f"Отель '{options['hotel']}' не найден")

        if options["from_orders"]:
            written = rebuild_raw_from_orders(hotel.pk)
            self.stdout.write(f"Журнал восстановлен: {written} объектов")

        count = recompute_aggregates(hotel.pk)
        self.stdout.write(self.style.SUCCESS(f"Пересчитано по {count} фактам журнала"))
