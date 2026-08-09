"""
Ревизор хранилища: найти объекты, за которыми в базе никого нет.

Зачем нужен отдельно от офбординга. Офбординг чинит будущее — а мусор, который
уже накопился, лежит и после него. На стенде его набралось 16 059 папок отелей
при восьми живых: каждый прогон E2E заводил отель с фотографиями и удалял его
строкой, объекты оставались. Полтора терабайта в пересчёте на год.

СВЕРКА ИДЁТ ПО БАЗЕ, А НЕ ПО ШАБЛОНУ ИМЕНИ. Соблазн велик: ключи выглядят как
`hotels/<uuid>/...`, и «удалить все папки, кроме живых отелей» пишется одной
строкой. Так и сносят живые данные — достаточно, чтобы отель не попал в выборку
из-за контекста тенанта или мягкого удаления. Поэтому объект считается
осиротевшим, только если его ключ не назван НИ ОДНИМ ассетом в базе.

    python manage.py audit_media_storage              # сухой прогон
    python manage.py audit_media_storage --purge      # удалить найденное
"""

from __future__ import annotations

from collections import defaultdict

from django.core.management.base import BaseCommand

from apps.core.context import tenant_context


class Command(BaseCommand):
    help = "Сверить объекты хранилища с базой и убрать осиротевшие"

    def add_arguments(self, parser):
        parser.add_argument(
            "--purge",
            action="store_true",
            help="удалить осиротевшие объекты (без флага — только показать)",
        )
        parser.add_argument(
            "--prefix",
            default="",
            help="сверять только этот префикс (например hotels/<id>/)",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=0,
            help="ограничить число удаляемых объектов за прогон (0 — без ограничения)",
        )

    def handle(self, *args, **options):
        from apps.hotels.models import Hotel
        from apps.media.models import MediaAsset
        from apps.media.services import storage
        from apps.media.services.assets import object_keys_of

        # 1. Что знает база.
        #
        # Обход ПО ОТЕЛЯМ, в контексте каждого: строки медиа закрыты RLS по
        # hotel_id, и попытка прочитать их одним запросом «поверх всех» требует
        # роли с BYPASSRLS. Такая роль есть в проде и нет в прогоне — ревизор,
        # написанный под неё, в тестах молча увидел бы ноль ассетов и объявил
        # осиротевшим ВСЁ хранилище. Это не гипотеза: ровно так он и повёл себя
        # на первой версии.
        hotels_qs = list(Hotel.all_objects.all())
        hotels = {str(hotel.pk) for hotel in hotels_qs}

        known: set[str] = set()
        asset_count = 0
        for hotel in hotels_qs:
            with tenant_context(hotel):
                for asset in MediaAsset.all_objects.all():
                    asset_count += 1
                    known.update(object_keys_of(asset))

        # 2. Что лежит в хранилище.
        keys = storage.list_keys(options["prefix"])

        orphans = [key for key in keys if key not in known]
        by_hotel: dict[str, int] = defaultdict(int)
        for key in orphans:
            parts = key.split("/")
            by_hotel[parts[1] if len(parts) > 2 and parts[0] == "hotels" else "(вне отелей)"] += 1

        dead = {hid for hid in by_hotel if hid not in hotels and hid != "(вне отелей)"}

        self.stdout.write(f"В базе: {asset_count} ассетов, {len(known)} ключей, {len(hotels)} отелей")
        self.stdout.write(f"В хранилище: {len(keys)} объектов")
        self.stdout.write(
            f"Осиротевших: {len(orphans)} объектов в {len(by_hotel)} папках, "
            f"из них папок несуществующих отелей — {len(dead)}"
        )
        for hid, count in sorted(by_hotel.items(), key=lambda item: -item[1])[:10]:
            mark = "отеля нет в базе" if hid in dead else "отель есть, объекты ничьи"
            self.stdout.write(f"  {hid}: {count} — {mark}")

        if not orphans:
            self.stdout.write(self.style.SUCCESS("Хранилище и база сходятся"))
            return

        if not options["purge"]:
            self.stdout.write(
                self.style.WARNING("Сухой прогон: ничего не удалено. Повторите с --purge.")
            )
            return

        limit = options["limit"] or len(orphans)
        result = storage.delete_objects(orphans[:limit])
        self.stdout.write(
            self.style.SUCCESS(
                f"Удалено объектов: {len(result['deleted'])}, не удалось: {len(result['failed'])}"
            )
        )
