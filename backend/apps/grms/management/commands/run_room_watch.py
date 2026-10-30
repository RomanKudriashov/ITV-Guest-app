"""Служба наблюдения за открытыми номерами (партия 65): см. apps/grms/services/watch.py."""

from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Читать номера с открытыми экранами и будить экраны при изменении состояния"

    def add_arguments(self, parser):
        parser.add_argument("--interval", type=float, default=2.0, help="секунд между проходами")

    def handle(self, *args, **options):
        from apps.grms.services import watch

        watch.run_forever(interval=max(0.5, options["interval"]))
