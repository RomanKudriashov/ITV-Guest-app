"""
Ещё два ПОЛНЫХ отеля рядом с «Кристаллом» — демонстрация мультитенантности.

Зачем отдельная команда, а не флаг в `seed_demo_hotel`. Тот сид описывает
ОДИН отель и завязан на его состав: фиксированные точки исполнения, фиксированный
каталог, фиксированные коды. На нём стоят 592 теста, и протаскивать через него
второй и третий отель с другим набором заведений значило бы менять то, что
держит весь набор. Здесь профиль отеля — данные, а не код: добавить четвёртый
отель означает дописать словарь.

ЧТО ЗДЕСЬ ВАЖНО: отели РАЗНЫЕ, а не копии с другим именем. Разный бренд
(пресет, обложка), разный масштаб (курорт с восемью заведениями против бутика с
четырьмя), разный состав типов. Одинаковые отели ничего не доказывают:
white-label виден только тогда, когда рядом стоит непохожий сосед.

Идемпотентна: повторный запуск ничего не дублирует и чинит недостающее.
"""

from __future__ import annotations

from datetime import time

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.accounts.models import StaffAssignment, User
from apps.catalog.models import (
    Category,
    Item,
    RequestField,
    Route,
    ServiceInclusion,
    ServiceLocation,
    SlotConfig,
)
from apps.catalog.offerings import LocationMode, OfferingType
from apps.catalog.request_fields import FieldType
from apps.core.context import tenant_context
from apps.hotels.models import (
    ExecutionPoint,
    Hotel,
    Location,
    Room,
    Schedule,
    ScheduleInterval,
    Service,
    ShowcaseTile,
)
from apps.media.models import MediaAsset

# --- Профили отелей --------------------------------------------------------
#
# Курорт и бутик выбраны намеренно как ПРОТИВОПОЛОЖНОСТИ по масштабу: на них
# видно и то, что модель тянет большой отель, и то, что она не разваливается на
# маленьком, где половины сущностей просто нет.

AZURE = {
    "subdomain": "azure",
    "name": "Азур Резорт",
    # Тёмная бирюза — третий цвет во флоте: у «Кристалла» тёмно-синий, у
    # «Люмена» светлый лён. Три отеля рядом должны различаться с первого взгляда.
    "preset": "tiffany_night",
    "cover": "hotel-cover-azure",
    "rooms": [("1{:02d}".format(n), "1") for n in range(1, 9)]
    + [("2{:02d}".format(n), "2") for n in range(1, 7)],
    "restaurants": [
        {
            "code": "marina",
            "public": ("Ресторан «Марина»", "Marina restaurant"),
            "tagline": ("Морская кухня у воды", "Seafood by the water"),
            "hours": (time(7, 0), time(23, 0)),
            "categories": [
                (
                    "marina-starters",
                    ("Закуски", "Starters"),
                    "bruschetta",
                    [
                        ("bruschetta", ("Брускетта", "Bruschetta"), ("Томаты и базилик", "Tomato and basil"), 39000),
                        ("burrata", ("Буррата", "Burrata"), ("С томатами и песто", "Tomatoes and pesto"), 72000),
                        ("octopus", ("Осьминог гриль", "Grilled octopus"), ("С лимоном и травами", "Lemon and herbs"), 104000),
                    ],
                ),
                (
                    "marina-mains",
                    ("Основные блюда", "Mains"),
                    "seabass",
                    [
                        ("seabass", ("Сибас на гриле", "Grilled sea bass"), ("Целиком", "Whole"), 132000),
                        ("salmon-steak", ("Стейк из лосося", "Salmon steak"), ("С овощами", "With vegetables"), 118000),
                        ("truffle-risotto", ("Ризотто с трюфелем", "Truffle risotto"), ("Карнароли", "Carnaroli"), 92000),
                    ],
                ),
                (
                    "marina-desserts",
                    ("Десерты", "Desserts"),
                    "pannacotta",
                    [
                        ("pannacotta", ("Панна-котта", "Panna cotta"), ("Ягодный соус", "Berry sauce"), 36000),
                        ("tiramisu", ("Тирамису", "Tiramisu"), ("Классический", "Classic"), 41000),
                    ],
                ),
            ],
        },
        {
            "code": "laguna-bar",
            "public": ("Пляжный бар «Лагуна»", "Laguna beach bar"),
            "tagline": ("Коктейли у воды", "Cocktails by the water"),
            "hours": (time(10, 0), time(1, 0)),
            "kind": ExecutionPoint.Kind.BAR,
            "service_type": Service.Type.BAR,
            "categories": [
                (
                    "laguna-cocktails",
                    ("Коктейли", "Cocktails"),
                    "mojito",
                    [
                        ("mojito", ("Мохито", "Mojito"), ("Лайм и мята", "Lime and mint"), 46000),
                        ("aperol", ("Апероль-шприц", "Aperol spritz"), ("Просекко", "Prosecco"), 52000),
                        ("margarita", ("Маргарита", "Margarita"), ("Текила, лайм", "Tequila, lime"), 54000),
                        ("virgin-mojito", ("Безалкогольный мохито", "Virgin mojito"), ("Без алкоголя", "Alcohol free"), 34000),
                    ],
                ),
                (
                    "laguna-soft",
                    ("Освежающее", "Refreshments"),
                    "fresh-orange",
                    [
                        ("fresh-orange", ("Апельсиновый фреш", "Fresh orange"), ("Свежевыжатый", "Freshly squeezed"), 32000),
                        ("lemonade", ("Домашний лимонад", "Homemade lemonade"), ("Мята, лайм", "Mint, lime"), 29000),
                        ("iced-latte", ("Айс-латте", "Iced latte"), ("На выбор молоко", "Choice of milk"), 33000),
                    ],
                ),
            ],
        },
    ],
    # Слоты: два бронируемых ресурса — спа и экскурсии.
    "slots": [
        {
            "code": "thalasso",
            "public": ("СПА «Талассо»", "Thalasso spa"),
            "tagline": ("Морская терапия", "Sea therapy"),
            "kind": ExecutionPoint.Kind.SPA,
            "service_type": Service.Type.SPA,
            "hours": (time(9, 0), time(21, 0)),
            "items": [
                ("thalasso-massage", ("Массаж 60 минут", "Massage 60 min"), ("Классический", "Classic"), 420000, 60, 3),
                ("thalasso-bath", ("Морская ванна", "Sea bath"), ("30 минут", "30 minutes"), 280000, 30, 2),
            ],
            "photo": "massage",
        },
        {
            "code": "excursions",
            "public": ("Экскурсии", "Excursions"),
            "tagline": ("Морские прогулки", "Sea trips"),
            "kind": ExecutionPoint.Kind.OTHER,
            "service_type": Service.Type.EXCURSIONS,
            "hours": (time(8, 0), time(18, 0)),
            "items": [
                ("boat-trip", ("Морская прогулка", "Boat trip"), ("2 часа вдоль побережья", "2 hours along the coast"), 560000, 120, 8),
            ],
            "photo": "venue-excursions",
        },
    ],
    # Заявки-формы.
    "requests": [
        {
            "code": "azure-concierge",
            "public": ("Консьерж", "Concierge"),
            "tagline": ("Трансфер и помощь", "Transfer and assistance"),
            "service_type": Service.Type.CONCIERGE,
            "photo": "venue-concierge",
            "items": [("transfer-azure", ("Трансфер", "Transfer"), ("Машина к выходу", "A car at the entrance"), "taxi")],
        },
        {
            "code": "azure-housekeeping",
            "public": ("Хозслужба", "Housekeeping"),
            "tagline": ("Уборка и бельё", "Cleaning and linen"),
            "service_type": Service.Type.HOUSEKEEPING,
            "kind": ExecutionPoint.Kind.HOUSEKEEPING,
            "guest_facing": False,
            "photo": "venue-housekeeping",
            "items": [("cleaning-azure", ("Уборка номера", "Room cleaning"), ("В удобное время", "At a convenient time"), "cleaning")],
        },
    ],
    # Рум-сервис — агрегатор: своего меню нет, он ЗАИМСТВУЕТ ресторан.
    "room_service": {
        "code": "azure-room-service",
        "public": ("Рум-сервис", "Room service"),
        "tagline": ("Круглосуточно в номер", "24/7 to your room"),
        "borrows": "marina",
        "markup_bp": 1500,
        "photo": "venue-room-service",
        # Своя маленькая карта сверх заимствованной: витрина показывает
        # заведение, только если у него есть хотя бы одна своя
        # замаршрутизированная категория. Чистый агрегатор без собственного
        # раздела на главную не попадает — так же устроен «Кристалл».
        "own": ("azure-night", ("Ночное меню", "Night menu"), "club-sandwich", [
            ("club-sandwich", ("Клубный сэндвич", "Club sandwich"), ("Круглосуточно", "24/7"), 58000),
            ("soup-day", ("Суп дня", "Soup of the day"), ("Спросите у консьержа", "Ask the concierge"), 42000),
        ]),
    },
    "info": {
        "code": "azure-info",
        "public": ("Об отеле", "About the hotel"),
        "tagline": ("Всё о курорте", "All about the resort"),
        "photo": "info",
        "pages": [
            ("azure-wifi", ("Wi-Fi", "Wi-Fi"), ("Сеть AZURE-GUEST, пароль на карте гостя.", "Network AZURE-GUEST, password on the guest card.")),
            ("azure-beach", ("Пляж", "Beach"), ("Полотенца у бассейна с 8:00 до 20:00.", "Towels at the pool from 8:00 to 20:00.")),
        ],
    },
    "staff": [
        ("chef@azure.local", "Шеф «Марины»", "marina"),
        ("barman@azure.local", "Бармен «Лагуны»", "laguna-bar"),
        ("spa@azure.local", "Мастер СПА", "thalasso"),
        ("concierge@azure.local", "Консьерж", "azure-concierge"),
    ],
    "showcase_threshold": 8,
}

LUMEN = {
    "subdomain": "lumen",
    "name": "Люмен Бутик",
    # Светлый лён: у отеля СВЕТЛЫЙ бренд по умолчанию. Это не «светлая тема
    # интерфейса», а выбор отеля — и на флоте видно, что тема может быть
    # свойством бренда, а не только тумблером у гостя.
    "preset": "marble_linen",
    "cover": "hotel-cover-lumen",
    "rooms": [("{:02d}".format(n), "1") for n in range(1, 13)],
    "restaurants": [
        {
            "code": "bistro",
            "public": ("Бистро «Люмен»", "Lumen bistro"),
            "tagline": ("Завтраки и ужины", "Breakfasts and dinners"),
            "hours": (time(8, 0), time(22, 0)),
            "categories": [
                (
                    "bistro-breakfast",
                    ("Завтраки", "Breakfasts"),
                    "syrniki",
                    [
                        ("syrniki", ("Сырники", "Syrniki"), ("Со сметаной", "With sour cream"), 42000),
                        ("breakfast-box", ("Завтрак в номер", "Breakfast in room"), ("Набор на одного", "Set for one"), 68000),
                        ("fruit-plate", ("Фруктовая тарелка", "Fruit plate"), ("Сезонные фрукты", "Seasonal fruit"), 45000),
                    ],
                ),
                (
                    "bistro-mains",
                    ("Основное", "Mains"),
                    "carbonara",
                    [
                        ("carbonara", ("Паста карбонара", "Carbonara"), ("Гуанчале, пекорино", "Guanciale, pecorino"), 74000),
                        ("beef-stroganoff", ("Бефстроганов", "Beef stroganoff"), ("С картофельным пюре", "With mashed potato"), 96000),
                        ("quinoa-salad", ("Салат с киноа", "Quinoa salad"), ("Авокадо, тофу", "Avocado, tofu"), 62000),
                    ],
                ),
            ],
        },
        {
            "code": "wine-bar",
            "public": ("Винный бар", "Wine bar"),
            "tagline": ("Вино и закуски", "Wine and snacks"),
            "hours": (time(17, 0), time(0, 0)),
            "kind": ExecutionPoint.Kind.BAR,
            "service_type": Service.Type.BAR,
            "categories": [
                (
                    "wine-list",
                    ("Винная карта", "Wine list"),
                    "wine-red",
                    [
                        ("wine-red", ("Красное вино", "Red wine"), ("Бокал 150 мл", "Glass 150 ml"), 58000),
                        ("wine-white", ("Белое вино", "White wine"), ("Бокал 150 мл", "Glass 150 ml"), 56000),
                        ("old-fashioned", ("Олд-фешен", "Old fashioned"), ("Виски, биттер", "Whisky, bitters"), 62000),
                    ],
                ),
            ],
        },
    ],
    "slots": [],
    "requests": [
        {
            "code": "lumen-concierge",
            "public": ("Консьерж", "Concierge"),
            "tagline": ("Помощь гостю", "Guest assistance"),
            "service_type": Service.Type.CONCIERGE,
            "photo": "venue-concierge",
            "items": [("transfer-lumen", ("Трансфер", "Transfer"), ("Машина к выходу", "A car at the entrance"), "taxi")],
        },
    ],
    "room_service": {
        "code": "lumen-room-service",
        "public": ("Рум-сервис", "Room service"),
        "tagline": ("В номер до полуночи", "To your room until midnight"),
        "borrows": "bistro",
        "markup_bp": 1000,
        "photo": "venue-room-service",
        "own": ("lumen-night", ("Ночное меню", "Night menu"), "club-sandwich", [
            ("club-sandwich", ("Клубный сэндвич", "Club sandwich"), ("До полуночи", "Until midnight"), 54000),
        ]),
    },
    "info": {
        "code": "lumen-info",
        "public": ("Об отеле", "About the hotel"),
        "tagline": ("Коротко о главном", "The essentials"),
        "photo": "info",
        "pages": [
            ("lumen-wifi", ("Wi-Fi", "Wi-Fi"), ("Сеть LUMEN, пароль на стойке.", "Network LUMEN, password at the desk.")),
        ],
    },
    "staff": [
        ("chef@lumen.local", "Шеф бистро", "bistro"),
        ("barman@lumen.local", "Сомелье", "wine-bar"),
    ],
    # Бутик маленький: порог ниже, и на главной рестораны сворачиваются в
    # группу. Это тоже часть демонстрации — витрина подстраивается под масштаб.
    "showcase_threshold": 3,
}

PROFILES = {profile["subdomain"]: profile for profile in (AZURE, LUMEN)}


class Command(BaseCommand):
    help = "Наполняет ещё два демо-отеля (курорт и бутик) рядом с «Кристаллом»"

    def add_arguments(self, parser):
        parser.add_argument(
            "--only",
            choices=sorted(PROFILES),
            help="Наполнить только один отель",
        )

    def handle(self, *args, **options):
        chosen = [PROFILES[options["only"]]] if options.get("only") else list(PROFILES.values())
        for profile in chosen:
            self._seed(profile)
        self.stdout.write(self.style.SUCCESS("Флот готов"))

    # --- Отель ------------------------------------------------------------

    @transaction.atomic
    def _seed(self, profile: dict):
        from apps.hotels.services.provisioning import provision_hotel
        from apps.orders.status_flows import ensure_status_flows

        hotel = provision_hotel(
            subdomain=profile["subdomain"],
            name=profile["name"],
            admin_email=f"owner@{profile['subdomain']}.local",
            languages=["ru", "en", "ar", "zh"],
            preset=profile["preset"],
            admin_password="chef12345",
            exist_ok=True,
        ).hotel

        with tenant_context(hotel):
            ensure_status_flows()
            locations = self._locations()
            self._rooms(profile["rooms"])

            services: dict[str, Service] = {}
            for spec in profile["restaurants"]:
                services[spec["code"]] = self._restaurant(spec, locations)
            for spec in profile["slots"]:
                services[spec["code"]] = self._slot_venue(spec)
            for spec in profile["requests"]:
                services[spec["code"]] = self._request_venue(spec)
            services.update(self._info_venue(profile["info"]))
            services[profile["room_service"]["code"]] = self._room_service(
                profile["room_service"], services, locations
            )

            # Ресепшен заводит `provision_hotel` — это каркас отеля, и снимка
            # у него нет и быть не должно: настоящему отелю не подставляют сток.
            # Демо-стенду кадр нужен, иначе в CMS остаётся серый прямоугольник.
            self._reception_cover()

            self._staff(hotel, profile["staff"], services)
            self._showcase(profile, services)
            self._cover(hotel, profile["cover"])
            self._fill_translations()

        self.stdout.write(
            f"Отель «{profile['name']}» ({profile['subdomain']}): "
            f"{len(profile['rooms'])} номеров, заведений {len(services)}"
        )

    # --- Кирпичи ----------------------------------------------------------

    def _image(self, code: str, label: str) -> MediaAsset | None:
        """
        Снимок из реестра, залитый ТЕМ ЖЕ медиапайплайном, что и загрузка из
        CMS. Нет снимка или MinIO — карточка останется без фото: демо-данные не
        должны быть причиной, по которой не поднимается окружение.
        """
        from apps.media.services import seed_photos
        from apps.media.services import upload_asset

        # Тот же кадр во второй раз НЕ заливаем. Раньше `_image` вызывался в
        # `defaults=` каждого get_or_create, то есть на КАЖДОМ прогоне, и на
        # существующей строке результат просто выбрасывался: объект оставался в
        # MinIO, строка в базе — в базе. Один прогон сида — десяток осиротевших
        # ассетов.
        # Имя несёт идентификатор кадра: заменили снимок в манифесте — прежний
        # ассет больше не подходит, и повторно он не переиспользуется.
        name = f"{code}--{seed_photos.photo_id(code)}.jpg"
        existing = MediaAsset.objects.filter(
            original_filename=name, status=MediaAsset.Status.READY
        ).first()
        if existing is not None:
            return existing

        content = seed_photos.fetch(code)
        if content is None:
            self.stdout.write(
                self.style.WARNING(
                    f"Фото для «{code}» недоступно ({label}). Прогоните fetch_seed_photos"
                )
            )
            return None
        try:
            return upload_asset(
                content=content,
                filename=name,
                kind=MediaAsset.Kind.CATEGORY,
                content_type="image/jpeg",
                alt=seed_photos.alt_text(code) or {"ru": label},
            )
        except Exception as exc:  # noqa: BLE001 — MinIO необязателен для старта
            self.stdout.write(self.style.WARNING(f"Медиа для «{code}» пропущено ({exc})"))
            return None

    def _ensure_image(self, obj, code: str, label: str) -> None:
        """
        Кадр объекту, у которого его нет.

        Раньше картинка передавалась в `defaults=` и доставалась ТОЛЬКО тем,
        кого этот прогон создал. На стенде это выглядело так: отель заведён
        раньше, чем в реестр добавили снимки, — и остался без единой картинки
        навсегда. Ни один пересев его не чинил: строки-то на месте.
        """
        if getattr(obj, "image_id", None) and not self._stale(obj.image, code):
            return
        asset = self._image(code, label)
        if asset is None:
            return
        obj.image = asset
        obj.save(update_fields=["image", "updated_at"])

    def _stale(self, asset, code: str) -> bool:
        """
        Кадр поставлен сидом, а в манифесте с тех пор другой.

        Без этого исправление манифеста не доезжает до поднятого стенда:
        обложка консьержа осталась бы пляжем и после того, как кадр заменили.
        Загрузку администратора правило не трогает — у неё своё имя файла.
        """
        from apps.media.services import seed_photos

        if asset is None:
            return False
        name = asset.original_filename or ""
        if name == f"{code}.jpg":  # старое имя: какой кадр внутри — неизвестно
            return True
        if not name.startswith(f"{code}--"):
            return False
        return name != f"{code}--{seed_photos.photo_id(code)}.jpg"

    def _ensure_photo(self, item, code: str, label: str) -> None:
        """Фотография позиции — по тому же правилу, что и кадр заведения."""
        from apps.catalog.models import ItemImage

        rows = list(ItemImage.objects.filter(item=item).select_related("asset"))
        if len(rows) == 1 and not self._stale(rows[0].asset, code):
            return
        if rows:
            ItemImage.objects.filter(item=item).hard_delete()
        asset = self._image(code, label)
        if asset is not None:
            ItemImage.objects.create(item=item, asset=asset, sort_order=0)

    def _schedule(self, name: str, start: time, end: time) -> Schedule:
        schedule, created = Schedule.objects.get_or_create(name=name)
        if created:
            for weekday in range(7):
                ScheduleInterval.objects.create(
                    schedule=schedule, weekday=weekday, start_time=start, end_time=end
                )
        return schedule

    def _locations(self) -> list[Location]:
        locations = []
        for code, kind, title, order in [
            ("in_room", Location.Kind.IN_ROOM, {"ru": "В номер", "en": "To the room"}, 0),
            ("pool", Location.Kind.COMMON_POINT, {"ru": "У бассейна", "en": "By the pool"}, 1),
        ]:
            location, _ = Location.objects.get_or_create(
                code=code,
                defaults={"kind": kind, "title": title, "sort_order": order},
            )
            locations.append(location)
        return locations

    def _rooms(self, spec: list[tuple[str, str]]) -> None:
        for number, floor in spec:
            Room.objects.get_or_create(number=number, defaults={"floor": floor})

    def _restaurant(self, spec: dict, locations: list[Location]) -> Service:
        start, end = spec["hours"]
        schedule = self._schedule(f"{spec['public'][0]} {start:%H:%M}–{end:%H:%M}", start, end)
        point, _ = ExecutionPoint.objects.get_or_create(
            code=spec["code"],
            defaults={
                "kind": spec.get("kind", ExecutionPoint.Kind.KITCHEN),
                "title": {"ru": spec["public"][0], "en": spec["public"][1]},
                "sla_minutes": 25,
            },
        )
        service, _ = Service.objects.get_or_create(
            execution_point=point,
            defaults={
                "code": point.code,
                "type": spec.get("service_type", Service.Type.RESTAURANT),
                "public_name": {"ru": spec["public"][0], "en": spec["public"][1]},
                "tagline": {"ru": spec["tagline"][0], "en": spec["tagline"][1]},
                "is_guest_facing": True,
                "schedule": schedule,
            },
        )
        self._ensure_image(service, f"venue-{spec['code']}", spec["public"][0])
        for order, (cat_code, cat_title, cover, items) in enumerate(spec["categories"]):
            category, _ = Category.objects.get_or_create(
                code=cat_code,
                defaults={
                    "type": OfferingType.PRODUCT,
                    "title": {"ru": cat_title[0], "en": cat_title[1]},
                    "sort_order": order,
                    "schedule": schedule,
                    "service": service,
                },
            )
            self._ensure_image(category, cover, cat_title[0])
            Route.objects.get_or_create(
                category=category, execution_point=point, defaults={"priority": 0}
            )
            for location in locations:
                ServiceLocation.objects.get_or_create(
                    category=category,
                    location=location,
                    defaults={
                        "delivery_modes": [
                            ServiceLocation.DeliveryMode.DELIVERY,
                            ServiceLocation.DeliveryMode.PICKUP,
                        ]
                    },
                )
            for index, (code, title, desc, price) in enumerate(items):
                self._product(category, code, title, desc, price, index)
        return service

    def _product(self, category, code, title, desc, price, order) -> Item:
        item, _ = Item.objects.get_or_create(
            code=code,
            defaults={
                "category": category,
                "type": OfferingType.PRODUCT,
                "title": {"ru": title[0], "en": title[1]},
                "description": {"ru": desc[0], "en": desc[1]},
                "price": price,
                "sort_order": order,
            },
        )
        # Ключ снимка — код позиции: одно блюдо, один кадр во всех отелях.
        self._ensure_photo(item, code, title[0])
        return item

    def _slot_venue(self, spec: dict) -> Service:
        start, end = spec["hours"]
        schedule = self._schedule(f"{spec['public'][0]} {start:%H:%M}–{end:%H:%M}", start, end)
        point, _ = ExecutionPoint.objects.get_or_create(
            code=spec["code"],
            defaults={
                "kind": spec["kind"],
                "title": {"ru": spec["public"][0], "en": spec["public"][1]},
                "sla_minutes": 20,
            },
        )
        service, _ = Service.objects.get_or_create(
            execution_point=point,
            defaults={
                "code": point.code,
                "type": spec["service_type"],
                "public_name": {"ru": spec["public"][0], "en": spec["public"][1]},
                "tagline": {"ru": spec["tagline"][0], "en": spec["tagline"][1]},
                "is_guest_facing": True,
                "schedule": schedule,
            },
        )
        self._ensure_image(service, f"venue-{spec['code']}", spec["public"][0])
        category, _ = Category.objects.get_or_create(
            code=f"{spec['code']}-slots",
            defaults={
                "type": OfferingType.SLOT,
                "title": {"ru": spec["public"][0], "en": spec["public"][1]},
                "sort_order": 0,
                "service": service,
            },
        )
        self._ensure_image(category, spec["photo"], spec["public"][0])
        Route.objects.get_or_create(
            category=category, execution_point=point, defaults={"priority": 0}
        )
        for index, (code, title, desc, price, minutes, capacity) in enumerate(spec["items"]):
            item, _ = Item.objects.get_or_create(
                code=code,
                defaults={
                    "category": category,
                    "type": OfferingType.SLOT,
                    "location_mode": LocationMode.NONE,
                    "title": {"ru": title[0], "en": title[1]},
                    "description": {"ru": desc[0], "en": desc[1]},
                    "price": price,
                    "sort_order": index,
                },
            )
            self._ensure_photo(item, spec["photo"], title[0])
            # Конфиг вне ветки created — повторный запуск чинит недостающее.
            SlotConfig.objects.update_or_create(
                item=item,
                defaults={
                    "duration_minutes": minutes,
                    "capacity": capacity,
                    "schedule": schedule,
                    "execution_point": point,
                    "lead_minutes": 30,
                    "horizon_days": 14,
                },
            )
        return service

    def _request_venue(self, spec: dict) -> Service:
        point, _ = ExecutionPoint.objects.get_or_create(
            code=spec["code"],
            defaults={
                "kind": spec.get("kind", ExecutionPoint.Kind.RECEPTION),
                "title": {"ru": spec["public"][0], "en": spec["public"][1]},
                "sla_minutes": 15,
            },
        )
        service, _ = Service.objects.get_or_create(
            execution_point=point,
            defaults={
                "code": point.code,
                "type": spec["service_type"],
                "public_name": {"ru": spec["public"][0], "en": spec["public"][1]},
                "tagline": {"ru": spec["tagline"][0], "en": spec["tagline"][1]},
                "is_guest_facing": spec.get("guest_facing", True),
            },
        )
        self._ensure_image(service, spec["photo"], spec["public"][0])
        category, _ = Category.objects.get_or_create(
            code=f"{spec['code']}-requests",
            defaults={
                "type": OfferingType.SERVICE_REQUEST,
                "title": {"ru": spec["public"][0], "en": spec["public"][1]},
                "sort_order": 0,
                "service": service,
            },
        )
        self._ensure_image(category, spec["photo"], spec["public"][0])
        Route.objects.get_or_create(
            category=category, execution_point=point, defaults={"priority": 0}
        )
        for index, (code, title, desc, photo) in enumerate(spec["items"]):
            item, created = Item.objects.get_or_create(
                code=code,
                defaults={
                    "category": category,
                    "type": OfferingType.SERVICE_REQUEST,
                    "location_mode": LocationMode.NONE,
                    "title": {"ru": title[0], "en": title[1]},
                    "description": {"ru": desc[0], "en": desc[1]},
                    "price": None,
                    "sort_order": index,
                },
            )
            self._ensure_photo(item, photo, title[0])
            if created:
                for order, (fcode, ru, en, ftype, required) in enumerate(
                    [
                        ("when", "Когда", "When", FieldType.TIME, True),
                        ("comment", "Пожелания", "Notes", FieldType.TEXT, False),
                    ]
                ):
                    RequestField.objects.get_or_create(
                        item=item,
                        code=fcode,
                        defaults={
                            "label": {"ru": ru, "en": en},
                            "field_type": ftype,
                            "is_required": required,
                            "sort_order": order,
                        },
                    )
        return service

    def _info_venue(self, spec: dict) -> dict[str, Service]:
        point, _ = ExecutionPoint.objects.get_or_create(
            code=spec["code"],
            defaults={
                "kind": ExecutionPoint.Kind.RECEPTION,
                "title": {"ru": spec["public"][0], "en": spec["public"][1]},
                "sla_minutes": 60,
            },
        )
        service, _ = Service.objects.get_or_create(
            execution_point=point,
            defaults={
                "code": point.code,
                "type": Service.Type.INFO,
                "public_name": {"ru": spec["public"][0], "en": spec["public"][1]},
                "tagline": {"ru": spec["tagline"][0], "en": spec["tagline"][1]},
                "is_guest_facing": True,
            },
        )
        self._ensure_image(service, spec["photo"], spec["public"][0])
        category, _ = Category.objects.get_or_create(
            code=f"{spec['code']}-pages",
            defaults={
                "type": OfferingType.INFO,
                "title": {"ru": spec["public"][0], "en": spec["public"][1]},
                "sort_order": 0,
                "service": service,
            },
        )
        self._ensure_image(category, spec["photo"], spec["public"][0])
        for index, (code, title, body) in enumerate(spec["pages"]):
            item, _ = Item.objects.get_or_create(
                code=code,
                defaults={
                    "category": category,
                    "type": OfferingType.INFO,
                    "location_mode": LocationMode.NONE,
                    "title": {"ru": title[0], "en": title[1]},
                    "description": {"ru": body[0], "en": body[1]},
                    "price": None,
                    "sort_order": index,
                },
            )
            self._ensure_photo(item, spec["photo"], title[0])
        return {spec["code"]: service}

    def _room_service(self, spec: dict, services: dict[str, Service], locations) -> Service:
        """
        Агрегатор: СВОЕГО меню нет, он заимствует ресторан по ссылке.

        Это и есть кросс-ссылка с наценкой — та же механика, что у «Кристалла»:
        одна позиция живёт в одном месте, а видна в двух, и заказ уезжает на
        доску РЕСТОРАНА, а не рум-сервиса.
        """
        point, _ = ExecutionPoint.objects.get_or_create(
            code=spec["code"],
            defaults={
                "kind": ExecutionPoint.Kind.KITCHEN,
                "title": {"ru": spec["public"][0], "en": spec["public"][1]},
                "sla_minutes": 30,
            },
        )
        service, _ = Service.objects.get_or_create(
            execution_point=point,
            defaults={
                "code": point.code,
                "type": Service.Type.ROOM_SERVICE,
                "public_name": {"ru": spec["public"][0], "en": spec["public"][1]},
                "tagline": {"ru": spec["tagline"][0], "en": spec["tagline"][1]},
                "is_guest_facing": True,
            },
        )
        self._ensure_image(service, spec["photo"], spec["public"][0])
        own_code, own_title, own_cover, own_items = spec["own"]
        category, _ = Category.objects.get_or_create(
            code=own_code,
            defaults={
                "type": OfferingType.PRODUCT,
                "title": {"ru": own_title[0], "en": own_title[1]},
                "sort_order": 0,
                "service": service,
            },
        )
        self._ensure_image(category, own_cover, own_title[0])
        Route.objects.get_or_create(
            category=category, execution_point=point, defaults={"priority": 0}
        )
        for location in locations:
            ServiceLocation.objects.get_or_create(
                category=category,
                location=location,
                defaults={
                    "delivery_modes": [
                        ServiceLocation.DeliveryMode.DELIVERY,
                        ServiceLocation.DeliveryMode.PICKUP,
                    ]
                },
            )
        for index, (code, title, desc, price) in enumerate(own_items):
            self._product(category, code, title, desc, price, index)

        source = services.get(spec["borrows"])
        if source is not None:
            ServiceInclusion.objects.get_or_create(
                including_service=service,
                source_service=source,
                defaults={
                    "scope": ServiceInclusion.Scope.ALL,
                    "markup_kind": ServiceInclusion.MarkupKind.PERCENT,
                    "markup_value": spec["markup_bp"],
                    "executor": ServiceInclusion.Executor.SOURCE,
                    "is_active": True,
                },
            )
        return service

    def _reception_cover(self) -> None:
        service = Service.objects.filter(code="reception").first()
        if service is None or service.image_id is not None:
            return
        asset = self._image("venue-reception", "Ресепшен")
        if asset is not None:
            service.image = asset
            service.save(update_fields=["image", "updated_at"])

    def _staff(self, hotel: Hotel, spec, services: dict[str, Service]) -> None:
        """
        По управляющему на каждое заведение отеля.

        `hotel` пользователю проставляется явно: без него строка не проходит
        политику RLS — база не даёт завести сотрудника «ничей».
        """
        for email, name, service_code in spec:
            service = services.get(service_code)
            if service is None:
                continue
            user = User.objects.filter(email=email).first()
            if user is None:
                user = User.objects.create_user(
                    email=email,
                    password="chef12345",
                    hotel=hotel,
                    full_name=name,
                    language="ru",
                    is_staff_member=True,
                )
            StaffAssignment.objects.get_or_create(
                user=user,
                execution_point=service.execution_point,
                defaults={"level": StaffAssignment.Level.MANAGER},
            )

    def _showcase(self, profile: dict, services: dict[str, Service]) -> None:
        hotel = Hotel.objects.get(subdomain=profile["subdomain"])
        hotel.showcase_group_threshold = profile["showcase_threshold"]
        hotel.save(update_fields=["showcase_group_threshold", "updated_at"])
        # Крупная плитка — первому заведению отеля: у витрины должен быть герой,
        # иначе главная читается как список одинаковых прямоугольников.
        for order, (code, service) in enumerate(services.items()):
            if not service.is_guest_facing:
                continue
            ShowcaseTile.objects.get_or_create(
                key=code,
                defaults={
                    "size": ShowcaseTile.Size.L if order == 0 else ShowcaseTile.Size.M,
                    "sort_order": order,
                    "is_enabled": True,
                },
            )

    def _fill_translations(self) -> None:
        """Арабский и китайский к ru/en — общий реестр `seed_translations`."""
        from apps.hotels.seed_translations import fill_translations

        filled = fill_translations()
        if filled:
            summary = ", ".join(f"{code}: {count}" for code, count in sorted(filled.items()))
            self.stdout.write(f"Переводы дописаны — {summary}")

    def _cover(self, hotel: Hotel, code: str) -> None:
        from apps.hotels.services.brand_services import cover_is_alive, get_or_create_brand
        from apps.media.tasks import process_media_asset

        theme = get_or_create_brand(hotel)
        # ОБЛОЖКА ЕСТЬ — это вопрос о картинке, а не о строке в токенах.
        # Прежний сторож жил в сиде отеля и спрашивал «непустой ли url»;
        # строка переживала и пересев фотографий, и смену публичного адреса
        # медиа, а картинка за ней — нет.
        if cover_is_alive(theme.tokens or {}):
            return

        asset = self._image(code, hotel.name)
        if asset is None:
            return
        tokens = dict(theme.tokens or {})
        brand = dict(tokens.get("brand") or {})
        background = dict(brand.get("background") or {})

        # Адрес можно записать только после нарезки вариантов: иначе в бренде
        # осядет заглушка. Дорезаем синхронно и берём настоящий url.
        try:
            process_media_asset.apply(args=(str(asset.pk), str(hotel.pk))).get()
        except Exception as exc:  # noqa: BLE001 — MinIO необязателен для старта
            self.stdout.write(self.style.WARNING(f"Обложка «{hotel.name}» не нарезана ({exc})"))
            return
        asset.refresh_from_db()
        url = asset.url("card")
        if not url:
            self.stdout.write(f"Обложка «{hotel.name}» ещё не готова — пропускаю")
            return
        # Ссылка на ассет — источник истины, адрес рядом — производное.
        background.update(
            {"kind": "image", "imageUrl": url, "imageAssetId": str(asset.pk), "dim": 0.15}
        )
        brand["background"] = background
        tokens["brand"] = brand
        theme.tokens = tokens
        theme.save(update_fields=["tokens", "updated_at"])
