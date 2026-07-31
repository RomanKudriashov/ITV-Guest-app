"""
Предзагрузка демо-фотографий в локальный кэш.

Отдельной командой, а не внутри сида: сеть — единственная часть наполнения,
которая может не работать, и падать из-за неё посреди создания отеля нельзя.
Прогнали один раз — дальше сид поднимается офлайн из кэша.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand

from apps.media.seed_photos import PHOTOS, cached_path, fetch


class Command(BaseCommand):
    help = "Скачивает демо-фотографии Unsplash в локальный кэш (.seed_photos/)"

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            help="перекачать даже то, что уже лежит в кэше",
        )

    def handle(self, *args, **options):
        force = options["force"]
        fetched, cached, failed = 0, 0, []

        for code in PHOTOS:
            existed = cached_path(code).exists()
            if existed and not force:
                cached += 1
                continue
            if fetch(code, force=force) is None:
                failed.append(code)
            else:
                fetched += 1

        self.stdout.write(
            f"скачано {fetched}, было в кэше {cached}, не удалось {len(failed)}"
        )
        if failed:
            # Не ошибка команды: сид умеет работать без части снимков.
            self.stdout.write(self.style.WARNING("без фото: " + ", ".join(failed)))
        else:
            self.stdout.write(self.style.SUCCESS("все снимки на месте"))
