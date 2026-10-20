"""
Большое меню для замеров (партия 61): заведение размера «Саввы» Метрополя.

    manage.py seed_big_menu --subdomain crystal [--categories 132] [--items 798] [--latest-photos N]

ЗАЧЕМ. На демо-отелях по три–двадцать позиций в заведении, и всё, что
растёт с числом позиций — запросы на позицию, вес ответа, — на них не видно.
У Метрополя в одном меню 798 позиций, и там сборка меню шла 10 секунд. Чтобы
мерить «было → стало» локально, нужен такой же объём с теми же связями:
аллергены, маркеры, характеристики, метки, фото, часы заведения и разделов.

ФОТО — ИЗ УЖЕ НАРЕЗАННЫХ ассетов отеля, по кругу: новых файлов команда не
создаёт. Повторяющиеся адреса браузер кэширует, поэтому вес картинок на таком
меню ниже настоящего — для веса картинок мерить живые меню, а это — для
запросов, времени сервера и веса ответа.

Идемпотентна: заведение с кодом `--service` уже есть — команда ничего не
делает (`--force` — пересоздать позиции).
"""

from __future__ import annotations

from datetime import time

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.core.context import actor_context, tenant_context


class Command(BaseCommand):
    help = "Завести заведение с большим меню для замеров (как «Савва» Метрополя)"

    def add_arguments(self, parser):
        parser.add_argument("--subdomain", default="crystal")
        parser.add_argument("--service", default="savva-bench")
        parser.add_argument("--categories", type=int, default=132)
        parser.add_argument("--items", type=int, default=798)
        parser.add_argument("--force", action="store_true")
        # Проверкам (партия 61-хвост): ровно N последних загруженных кадров —
        # при `--categories N` у каждого раздела свой кадр.
        parser.add_argument("--latest-photos", type=int, default=0)

    def handle(self, *args, **opts):
        from apps.accounts.models import User
        from apps.catalog.models import (
            Allergen,
            Badge,
            Category,
            DietaryMarker,
            Item,
            ItemAllergen,
            ItemBadge,
            ItemCharacteristic,
            ItemDietaryMarker,
            ItemImage,
        )
        from apps.catalog.services.cms import create_category
        from apps.hotels.models import Hotel, Schedule, ScheduleInterval, Service
        from apps.hotels.services.admin_services import create_service
        from apps.media.models import MediaAsset

        hotel = Hotel.objects.filter(subdomain=opts["subdomain"]).first()
        if hotel is None:
            raise CommandError(f"Нет отеля «{opts['subdomain']}»")
        code = opts["service"]

        with tenant_context(hotel), transaction.atomic():
            admin = User.objects.filter(is_hotel_admin=True).order_by("created_at").first()
            if admin is None:
                raise CommandError("У отеля нет администратора — заводить заведение не от кого")
            with actor_context(admin):
                service = Service.objects.filter(code=code).first()
                if service is not None and not opts["force"]:
                    self.stdout.write(f"заведение «{code}» уже есть — ничего не делаю (--force — пересоздать)")
                    return
                if service is None:
                    service = create_service(
                        {"code": code, "type": Service.Type.RESTAURANT, "public_name": {"ru": "Савва (замер)"}}
                    )
                Item.all_objects.filter(category__service=service).hard_delete()
                Category.all_objects.filter(service=service).hard_delete()

                hours = Schedule.objects.create(name=f"{code}: часы")
                for weekday in range(7):
                    ScheduleInterval.objects.create(
                        schedule=hours, weekday=weekday, start_time=time(7, 0), end_time=time(23, 0)
                    )
                service.schedule = hours
                service.save(update_fields=["schedule", "updated_at"])

                ready = MediaAsset.objects.filter(status=MediaAsset.Status.READY).exclude(variants={})
                if opts["latest_photos"]:
                    assets = list(ready.order_by("-created_at")[: opts["latest_photos"]])[::-1]
                else:
                    assets = list(ready.order_by("created_at")[:60])
                allergens = list(Allergen.objects.filter(is_active=True)[:6])
                markers = list(DietaryMarker.objects.filter(is_active=True)[:4])
                badges = list(Badge.objects.filter(is_active=True)[:3])

                categories = [
                    create_category(
                        {"title": {"ru": f"Раздел {n + 1}"}, "service_id": str(service.pk), "sort_order": n}
                    )
                    for n in range(opts["categories"])
                ]
                for n in range(opts["items"]):
                    item = Item.objects.create(
                        category=categories[n % len(categories)],
                        code=f"{code}-{n + 1}",
                        title={"ru": f"Блюдо {n + 1}", "en": f"Dish {n + 1}"},
                        description={"ru": "Описание блюда для замера: состав, подача, граммовка."},
                        price=(n % 40 + 5) * 10000,
                        sort_order=n,
                        attributes={"nutrition": {"calories": 300 + n % 200, "portion": 250}},
                    )
                    if assets:
                        ItemImage.objects.create(item=item, asset=assets[n % len(assets)], sort_order=0)
                    for k, allergen in enumerate(allergens[: n % 4]):
                        ItemAllergen.objects.create(item=item, allergen=allergen)
                    for marker in markers[: n % 3]:
                        ItemDietaryMarker.objects.create(item=item, marker=marker)
                    for k in range(n % 3):
                        ItemCharacteristic.objects.create(
                            item=item, name={"ru": f"Свойство {k + 1}"}, value={"ru": "значение"}, sort_order=k
                        )
                    if badges and n % 5 == 0:
                        ItemBadge.objects.create(item=item, badge=badges[n % len(badges)], sort_order=0)
        self.stdout.write(
            f"заведение «{code}»: разделов {opts['categories']}, позиций {opts['items']}, фото из {len(assets)} ассетов"
        )
