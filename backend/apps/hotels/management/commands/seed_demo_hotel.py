"""
Сид эталонного отеля.

Наполняет ровно столько, чтобы прошёл дымовой сценарий
«сессия → меню → заказ → статус» и чтобы было видно, как устроен каждый узел
фундамента: тенант, бренд, языки, точки исполнения, персонал, каталог с
модификаторами, номера, локации, расписания, пресет статусов.

Команда идемпотентна: повторный запуск ничего не дублирует.
Второй отель (--subdomain aurora) нужен для проверки изоляции руками.
"""

from __future__ import annotations

import io
from datetime import time

from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.accounts.models import StaffAssignment, User
from apps.catalog.models import (
    Category,
    Item,
    ItemImage,
    LocationMode,
    ModifierGroup,
    ModifierOption,
    OfferingType,
    RequestField,
    Route,
    ServiceLocation,
    SlotConfig,
)
from apps.catalog.request_fields import FieldType
from apps.core.context import tenant_context
from apps.core.errors import DomainError
from apps.core.fields import translate
from apps.hotels.models import (
    BrandTheme,
    ExecutionPoint,
    Hotel,
    HotelLanguage,
    Location,
    Room,
    Schedule,
    ScheduleInterval,
    Service,
)
from apps.hotels.venue_defaults import service_type_for_kind
from apps.media.models import CategoryPlaceholder, MediaAsset
from apps.notifications.models import (
    ChannelType,
    EscalationRule,
    EscalationStep,
    NotificationChannel,
    TargetKind,
)
from apps.orders import status_flows
from apps.orders.status_flows import ensure_status_flows

# Токены бренда. Формат совпадает с BrandTokens во фронте — это один контракт,
# а не две похожие структуры.
CRYSTAL_TOKENS = {
    "palette": {
        "light": {
            "primary": "#0F766E",
            "secondary": "#B45309",
            "background": "#F8FAFC",
            "surface": "#FFFFFF",
            "text": "#0F172A",
            "textMuted": "#64748B",
            "border": "#E2E8F0",
            "success": "#15803D",
            "warning": "#B45309",
            "danger": "#B91C1C",
        },
        "dark": {
            "primary": "#2DD4BF",
            "secondary": "#FBBF24",
            "background": "#0B1220",
            "surface": "#111C2E",
            "text": "#E2E8F0",
            "textMuted": "#94A3B8",
            "border": "#1E293B",
            "success": "#4ADE80",
            "warning": "#FBBF24",
            "danger": "#F87171",
        },
    },
    "typography": {"fontFamily": "'Manrope', system-ui, sans-serif"},
    "shape": {"borderRadius": 14},
    "spacingUnit": 8,
}

PLACEHOLDERS = [
    ("default", "Заглушка по умолчанию"),
    ("hot", "Горячее"),
    ("salads", "Салаты"),
    ("drinks", "Напитки"),
]


def _venue_photo_code(service_code: str) -> str:
    """
    Ключ снимка заведения по коду сервиса.

    Коды сервисов пишутся через подчёркивание (`room_service`), ключи реестра
    снимков — через дефис (`venue-room-service`). Без приведения рум-сервис
    молча оставался без обложки: снимок в реестре есть, а искали его под
    несуществующим именем.
    """
    return f"venue-{service_code.replace('_', '-')}"


class Command(BaseCommand):
    help = "Наполняет демо-отель данными для дымового сценария"

    def add_arguments(self, parser):
        parser.add_argument("--subdomain", default="crystal")
        parser.add_argument("--name", default="Отель «Кристалл»")
        parser.add_argument(
            "--with-second-hotel",
            action="store_true",
            help="Создать второй отель (aurora) — удобно проверять изоляцию руками",
        )
        parser.add_argument(
            "--force",
            action="store_true",
            help="Досоздать недостающее в уже существующем отеле",
        )
        parser.add_argument(
            "--with-guest-history",
            action="store_true",
            help=(
                "Досоздать демо-заявку с отзывом. По умолчанию выкл: реальная "
                "заявка сдвигает нумерацию заказов, на которую опираются тесты."
            ),
        )
        parser.add_argument(
            "--with-analytics-history",
            action="store_true",
            help=(
                "Сгенерировать несколько недель истории заказов для наглядности "
                "дашборда. По умолчанию выкл: как и гостевая история, сдвигает "
                "нумерацию заказов, на которую опираются тесты."
            ),
        )
        parser.add_argument(
            "--with-marketing-badges",
            action="store_true",
            help="Завести пресеты бейджей (Хит/Новинка/Выбор шефа) и повесить на позиции.",
        )
        parser.add_argument(
            "--with-rich-catalog",
            action="store_true",
            help=(
                "Наглядно наполнить «Кристалла»: доп. рестораны, рум-сервис, бар-"
                "меню, 50+ позиций с фото/КБЖУ/фасетами, венью-часы, витринные "
                "плитки, per-service коммерция, включённые модули. По умолчанию "
                "выкл: тесты этот путь не гоняют (иначе пере-сид с фото на каждый "
                "тест был бы неподъёмным), объём — только для демо-витрины."
            ),
        )

    def handle(self, *args, **options):
        history = options["with_guest_history"]
        analytics = options["with_analytics_history"]
        badges = options["with_marketing_badges"]
        rich = options["with_rich_catalog"]
        self._seed_placeholders()
        self._seed_hotel(options["subdomain"], options["name"], options["force"], history, analytics, badges, rich)
        if options["with_second_hotel"]:
            self._seed_hotel("aurora", "Aurora Boutique Hotel", options["force"], history, analytics, badges, rich)
        # Управление номером — только ДЕМО-отелю, и только ему.
        #
        # Второй отель остаётся без модуля намеренно: на нём проверяется, что
        # выключенный модуль означает отсутствие раздела, а не пустой экран.
        # Демо-вход без PIN включается тоже только здесь — это временное
        # послабление MVP, и разъезжаться по всем отелям оно не должно.
        call_command(
            "seed_grms_demo",
            subdomain=options["subdomain"],
            demo_entry=True,
            verbosity=0,
        )
        self.stdout.write(self.style.SUCCESS("Сид завершён"))

    # --- Платформенный уровень ------------------------------------------

    def _seed_placeholders(self):
        for code, title in PLACEHOLDERS:
            CategoryPlaceholder.objects.get_or_create(
                code=code,
                defaults={
                    "title": title,
                    "image_url": f"/static/placeholders/{code}.svg",
                },
            )

    # --- Отель ------------------------------------------------------------

    @transaction.atomic
    def _seed_hotel(self, subdomain: str, name: str, force: bool, with_history: bool = False, with_analytics: bool = False, with_badges: bool = False, with_rich: bool = False):
        from apps.hotels.provisioning import provision_hotel

        existing = Hotel.objects.filter(subdomain=subdomain).first()
        if existing and not force:
            self.stdout.write(f"Отель '{subdomain}' уже существует — пропускаю")
            return

        # Каркас (hotel, языки, бренд, ресепшен, hotel-admin) — через единую
        # точку создания отеля. Демо-контент кладём ПОВЕРХ, не дублируя создание.
        # Разным отелям — разные пресеты, чтобы white-label читался сразу:
        # Crystal — тёмно-синий, Aurora — светлый глубокий синий.
        preset = "harbor_light" if subdomain == "aurora" else "midnight_navy"
        hotel = provision_hotel(
            subdomain=subdomain,
            name=name,
            admin_email=f"owner@{subdomain}.local",
            languages=["ru", "en", "ar", "zh"],
            preset=preset,
            admin_password="chef12345",
            exist_ok=True,
        ).hotel

        with tenant_context(hotel):
            points = self._seed_execution_points()
            kitchen = points["kitchen"]
            users = self._seed_staff(hotel, points)
            # Пресеты статусов уже завёл provision_hotel; зовём повторно (это
            # идемпотентно) на случай отеля, созданного до R3.
            ensure_status_flows()
            rooms = self._seed_rooms()
            locations = self._seed_locations()
            schedules = self._seed_schedules()
            self._seed_catalog(kitchen, locations, schedules)
            self._seed_nutrition()
            self._seed_item_facets()
            self._seed_services(points, schedules)
            self._seed_info_pages()
            self._seed_slot_resources(points, schedules)
            if with_rich:
                self._seed_rich_catalog(hotel, points, locations, schedules)
            self._seed_bar_menu(points)
            self._link_categories_to_services()
            self._seed_venue_covers()
            self._ensure_item_photos()
            self._ensure_category_photos()
            self._seed_hotel_cover(hotel)
            self._seed_notifications(points, users)
            self._seed_chat_and_reviews(points, with_history)
            if with_badges:
                self._seed_marketing_badges()
            if with_analytics:
                self._seed_analytics_history(hotel, points, rooms, users)

        self.stdout.write(
            self.style.SUCCESS(
                f"Отель '{subdomain}' готов: {len(rooms)} номеров, "
                f"локации {[loc.code for loc in locations]}"
            )
        )

    def _seed_execution_points(self) -> dict[str, ExecutionPoint]:
        """
        Отделы отеля. Заявки-услуги уходят в свои: такси — консьержу, уборка —
        в хозслужбу. Это обычная работа Route, а не отдельная механика.
        """
        # title — служебное (трекер/персонал); public/tagline — гостевое;
        # guest — показывать ли точку гостю на витрине. Хозслужба служебная.
        specs = [
            ("kitchen", ExecutionPoint.Kind.KITCHEN, "Кухня ресторана", "Restaurant kitchen", 20,
             ("Панорама", "Panorama"), ("Европейская кухня", "European cuisine"), True),
            ("bar", ExecutionPoint.Kind.BAR, "Лобби-бар", "Lobby bar", 15,
             ("Лобби-бар", "Lobby bar"), ("Коктейли и вино", "Cocktails & wine"), True),
            ("concierge", ExecutionPoint.Kind.RECEPTION, "Консьерж", "Concierge", 10,
             ("Консьерж", "Concierge"), ("Такси и экскурсии", "Taxi & tours"), True),
            ("housekeeping", ExecutionPoint.Kind.HOUSEKEEPING, "Хозслужба", "Housekeeping", 45,
             ("Хозслужба", "Housekeeping"), ("", ""), False),
            ("spa", ExecutionPoint.Kind.SPA, "SPA-центр", "SPA", 30,
             ("СПА «Кристалл»", "Crystal Spa"), ("Массаж и уход", "Massage & care"), True),
        ]
        points: dict[str, ExecutionPoint] = {}
        for code, kind, ru, en, sla, public, tagline, guest in specs:
            point, _ = ExecutionPoint.objects.get_or_create(
                code=code,
                defaults={
                    "kind": kind,
                    "title": {"ru": ru, "en": en},
                    "sla_minutes": sla,
                },
            )
            # Гостевая идентичность живёт на сервисе-контейнере (1:1 с точкой).
            Service.objects.get_or_create(
                execution_point=point,
                defaults={
                    "code": point.code,
                    "type": service_type_for_kind(kind),
                    "public_name": {"ru": public[0], "en": public[1]},
                    "tagline": ({"ru": tagline[0], "en": tagline[1]} if tagline[0] else {}),
                    "is_guest_facing": guest,
                },
            )
            points[code] = point
        return points

    def _seed_staff(self, hotel: Hotel, points: dict[str, ExecutionPoint]) -> dict[str, User]:
        """
        Каждому сервису — свой управляющий и свои линейные: доски не должны
        пересекаться, а роли должны быть проверяемы вживую.

        Уровень привязки и ЕСТЬ роль (apps/accounts/roles.py): `manager` —
        управляющий сервисом (правит своё меню, расписание, коммерцию, персонал,
        видит свою аналитику), `member`/`lead` — линейный (только трекер).
        Админ отеля — owner@<поддомен>.local, его завёл provision_hotel.
        """
        specs = [
            # Управляющие — по одному на сервис.
            ("manager.restaurant", "Сергей, управляющий «Панорамой»", "kitchen",
             StaffAssignment.Level.MANAGER),
            ("manager.bar", "Ольга, управляющая баром", "bar",
             StaffAssignment.Level.MANAGER),
            ("manager.spa", "Елена, управляющая СПА", "spa",
             StaffAssignment.Level.MANAGER),
            ("manager.concierge", "Тимур, старший консьерж", "concierge",
             StaffAssignment.Level.MANAGER),
            ("manager.housekeeping", "Галина, управляющая хозслужбой", "housekeeping",
             StaffAssignment.Level.MANAGER),
            # Линейный персонал — по нему проверяется, что в CMS его не пускают.
            ("chef", "Пётр, повар", "kitchen", StaffAssignment.Level.LEAD),
            ("barman", "Никита, бармен", "bar", StaffAssignment.Level.MEMBER),
            ("concierge", "Анна, консьерж", "concierge", StaffAssignment.Level.MEMBER),
            ("maid", "Мария, горничная", "housekeeping", StaffAssignment.Level.MEMBER),
            ("spa", "Ирина, СПА-мастер", "spa", StaffAssignment.Level.LEAD),
        ]
        created_users: dict[str, User] = {}
        for prefix, full_name, point_code, level in specs:
            email = f"{prefix}@{hotel.subdomain}.local"
            user = User.objects.filter(email=email).first()
            if user is None:
                user = User.objects.create_user(
                    email=email,
                    password="chef12345",
                    hotel=hotel,
                    full_name=full_name,
                    language="ru",
                    is_staff_member=True,
                )
            StaffAssignment.objects.get_or_create(
                user=user,
                execution_point=points[point_code],
                defaults={"level": level},
            )
            created_users[prefix] = user
        return created_users

    def _seed_rooms(self) -> list[Room]:
        rooms = []
        for floor in ("2", "3", "4"):
            for index in ("01", "05", "12"):
                room, _ = Room.objects.get_or_create(
                    number=f"{floor}{index}",
                    defaults={
                        "floor": floor,
                        "zone": "Главный корпус",
                        "source": Room.Source.MANUAL,
                    },
                )
                rooms.append(room)
        return rooms

    def _seed_locations(self) -> list[Location]:
        in_room, _ = Location.objects.get_or_create(
            code="in_room",
            defaults={
                "kind": Location.Kind.IN_ROOM,
                "title": {"ru": "В номер", "en": "To the room"},
                "sort_order": 0,
            },
        )
        pool, _ = Location.objects.get_or_create(
            code="pool",
            defaults={
                "kind": Location.Kind.COMMON_POINT,
                "title": {"ru": "У бассейна", "en": "By the pool"},
                "requires_refinement": True,
                "refinement_label": {"ru": "Номер шезлонга", "en": "Sunbed number"},
                "sort_order": 1,
            },
        )
        return [in_room, pool]

    def _seed_schedules(self) -> dict[str, Schedule]:
        all_day, created = Schedule.objects.get_or_create(
            name="Круглосуточно", defaults={"is_always_open": True}
        )

        kitchen_hours, created = Schedule.objects.get_or_create(
            name="Кухня 07:00–23:00"
        )
        if created:
            for weekday in range(7):
                ScheduleInterval.objects.create(
                    schedule=kitchen_hours,
                    weekday=weekday,
                    start_time=time(7, 0),
                    end_time=time(23, 0),
                )

        breakfast, created = Schedule.objects.get_or_create(name="Завтрак 07:00–11:00")
        if created:
            for weekday in range(7):
                ScheduleInterval.objects.create(
                    schedule=breakfast,
                    weekday=weekday,
                    start_time=time(7, 0),
                    end_time=time(11, 0),
                    day_part="breakfast",
                )

        return {"all_day": all_day, "kitchen": kitchen_hours, "breakfast": breakfast}

    # --- Каталог ----------------------------------------------------------

    def _seed_catalog(
        self,
        kitchen: ExecutionPoint,
        locations: list[Location],
        schedules: dict[str, Schedule],
    ):
        categories = {}
        # Категории круглосуточны намеренно. Ограничение по часам показывает
        # «Сырники» (только завтрак) — так демо остаётся наглядным, а тесты,
        # создающие заказы, перестают зависеть от времени суток: ночной прогон
        # раньше падал на «доступно с 07:00».
        for order, (code, ru, en, schedule) in enumerate(
            [
                ("hot", "Горячее", "Hot dishes", schedules["all_day"]),
                ("salads", "Салаты", "Salads", schedules["all_day"]),
                ("drinks", "Напитки", "Drinks", schedules["all_day"]),
            ]
        ):
            category, _ = Category.objects.get_or_create(
                code=code,
                defaults={
                    "type": OfferingType.PRODUCT,
                    "title": {"ru": ru, "en": en},
                    "sort_order": order,
                    "schedule": schedule,
                    "image": self._image_for(code, ru),
                },
            )
            categories[code] = category

            Route.objects.get_or_create(
                category=category, execution_point=kitchen, defaults={"priority": 0}
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

        self._seed_items(categories, schedules)

    def _seed_items(self, categories: dict[str, Category], schedules: dict[str, Schedule]):
        steak, created = Item.objects.get_or_create(
            code="ribeye",
            defaults={
                "category": categories["hot"],
                "title": {"ru": "Стейк рибай", "en": "Ribeye steak", "ar": "ستيك ريب آي"},
                "description": {
                    "ru": "Мраморная говядина, 300 г, гриль",
                    "en": "Marbled beef, 300 g, grilled",
                },
                "price": 190000,  # 1 900 ₽ в копейках
                "sort_order": 0,
            },
        )
        if created:
            self._attach_image(steak, "hot", "Стейк рибай")
            # Обязательная группа: без прожарки заказ на кухню не уходит.
            doneness = ModifierGroup.objects.create(
                item=steak,
                code="doneness",
                title={"ru": "Прожарка", "en": "Doneness"},
                selection=ModifierGroup.Selection.SINGLE,
                is_required=True,
                min_choices=1,
                max_choices=1,
                sort_order=0,
            )
            for order, (code, ru, en, default) in enumerate(
                [
                    ("rare", "С кровью", "Rare", False),
                    ("medium_rare", "Медиум рэр", "Medium rare", True),
                    ("medium", "Медиум", "Medium", False),
                    ("well_done", "Прожаренный", "Well done", False),
                ]
            ):
                ModifierOption.objects.create(
                    group=doneness,
                    code=code,
                    title={"ru": ru, "en": en},
                    price_delta=0,
                    is_default=default,
                    sort_order=order,
                )

            extras = ModifierGroup.objects.create(
                item=steak,
                code="extras",
                title={"ru": "Добавки", "en": "Extras"},
                selection=ModifierGroup.Selection.MULTI,
                is_required=False,
                min_choices=0,
                max_choices=3,
                sort_order=1,
            )
            for order, (code, ru, en, price) in enumerate(
                [
                    ("sauce_pepper", "Перечный соус", "Pepper sauce", 15000),
                    ("grilled_veg", "Овощи гриль", "Grilled vegetables", 25000),
                    ("truffle_fries", "Картофель с трюфелем", "Truffle fries", 35000),
                ]
            ):
                ModifierOption.objects.create(
                    group=extras,
                    code=code,
                    title={"ru": ru, "en": en},
                    price_delta=price,
                    sort_order=order,
                )

        caesar, created = Item.objects.get_or_create(
            code="caesar",
            defaults={
                "category": categories["salads"],
                "title": {"ru": "Салат «Цезарь»", "en": "Caesar salad"},
                "description": {
                    "ru": "Курица, пармезан, соус цезарь",
                    "en": "Chicken, parmesan, caesar dressing",
                },
                "price": 55000,
                "sort_order": 0,
            },
        )
        if created:
            self._attach_image(caesar, "salads", "Салат Цезарь")

        lemonade, created = Item.objects.get_or_create(
            code="lemonade",
            defaults={
                "category": categories["drinks"],
                "title": {"ru": "Домашний лимонад", "en": "Homemade lemonade"},
                "description": {"ru": "Лимон, мята, 400 мл", "en": "Lemon, mint, 400 ml"},
                "price": 39000,
                "sort_order": 0,
            },
        )
        if created:
            self._attach_image(lemonade, "drinks", "Лимонад")

        # Ещё несколько позиций — чтобы в CMS было что сортировать и
        # редактировать, а не один элемент на категорию.
        pasta, created = Item.objects.get_or_create(
            code="carbonara",
            defaults={
                "category": categories["hot"],
                "title": {"ru": "Паста карбонара", "en": "Pasta carbonara"},
                "description": {
                    "ru": "Гуанчале, пекорино, яичный желток",
                    "en": "Guanciale, pecorino, egg yolk",
                },
                "price": 69000,
                "sort_order": 1,
            },
        )
        if created:
            self._attach_image(pasta, "hot", "Паста карбонара")

        greek, created = Item.objects.get_or_create(
            code="greek-salad",
            defaults={
                "category": categories["salads"],
                "title": {"ru": "Греческий салат", "en": "Greek salad"},
                "description": {
                    "ru": "Фета, огурцы, томаты, оливки",
                    "en": "Feta, cucumber, tomatoes, olives",
                },
                "price": 48000,
                "sort_order": 1,
            },
        )
        if created:
            self._attach_image(greek, "salads", "Греческий салат")

        # Позиция с day-parting: сырники есть только на завтрак.
        syrniki, created = Item.objects.get_or_create(
            code="syrniki",
            defaults={
                "category": categories["hot"],
                "title": {"ru": "Сырники", "en": "Cottage cheese pancakes"},
                "description": {
                    "ru": "Со сметаной и вареньем, только на завтрак",
                    "en": "With sour cream and jam, breakfast only",
                },
                "price": 45000,
                "schedule": schedules["breakfast"],
                "sort_order": 2,
            },
        )
        if created:
            self._attach_image(syrniki, "hot", "Сырники")

        cappuccino, created = Item.objects.get_or_create(
            code="cappuccino",
            defaults={
                "category": categories["drinks"],
                "title": {"ru": "Капучино", "en": "Cappuccino"},
                "description": {"ru": "На выбор молоко", "en": "Choice of milk"},
                "price": 32000,
                "sort_order": 1,
            },
        )
        if created:
            self._attach_image(cappuccino, "drinks", "Капучино")
            milk = ModifierGroup.objects.create(
                item=cappuccino,
                code="milk",
                title={"ru": "Молоко", "en": "Milk"},
                selection=ModifierGroup.Selection.SINGLE,
                is_required=True,
                min_choices=1,
                max_choices=1,
                sort_order=0,
            )
            for order, (code, ru, en, price, default) in enumerate(
                [
                    ("regular", "Обычное", "Regular", 0, True),
                    ("oat", "Овсяное", "Oat", 5000, False),
                    ("almond", "Миндальное", "Almond", 7000, False),
                ]
            ):
                ModifierOption.objects.create(
                    group=milk,
                    code=code,
                    title={"ru": ru, "en": en},
                    price_delta=price,
                    is_default=default,
                    sort_order=order,
                )

    # --- Заявки-услуги ----------------------------------------------------

    def _seed_services(self, points: dict[str, ExecutionPoint], schedules: dict[str, Schedule]):
        """
        Второй тип предложения в тех же таблицах: та же Category, тот же Item,
        тот же Route. Отличие — тип и поля формы вместо модификаторов.
        """
        taxi_category = self._seed_service_category(
            code="transfer",
            title={"ru": "Трансфер", "en": "Transfer"},
            point=points["concierge"],
            sort_order=10,
            schedule=schedules["all_day"],
        )
        cleaning_category = self._seed_service_category(
            code="housekeeping",
            title={"ru": "Уборка", "en": "Housekeeping"},
            point=points["housekeeping"],
            sort_order=11,
            schedule=schedules["all_day"],
        )

        taxi, created = Item.objects.get_or_create(
            code="taxi",
            defaults={
                "category": taxi_category,
                "type": OfferingType.SERVICE_REQUEST,
                # Точка подачи — поле заявки, поэтому локацию не спрашиваем.
                "location_mode": LocationMode.NONE,
                "title": {"ru": "Такси", "en": "Taxi"},
                "description": {
                    "ru": "Подадим машину к выходу из отеля",
                    "en": "We will bring a car to the hotel entrance",
                },
                # Цены нет: считает перевозчик по факту.
                "price": None,
                "sort_order": 0,
            },
        )
        if created:
            self._attach_image(taxi, "default", "Такси")
            self._seed_request_fields(
                taxi,
                [
                    ("destination", "Куда", "Where to", FieldType.TEXT, True,
                     {"ru": "Адрес или название места"}, None, None, []),
                    ("when", "Когда подать", "Pickup time", FieldType.TIME, True,
                     {}, None, None, []),
                    ("passengers", "Сколько человек", "Passengers", FieldType.COUNT, True,
                     {}, 1, 8, []),
                    ("car_class", "Класс машины", "Car class", FieldType.SELECT, False,
                     {}, None, None,
                     [
                         {"value": "econom", "label": {"ru": "Эконом", "en": "Economy"}},
                         {"value": "comfort", "label": {"ru": "Комфорт", "en": "Comfort"}},
                         {"value": "minivan", "label": {"ru": "Минивэн", "en": "Minivan"}},
                     ]),
                ],
            )

        cleaning, created = Item.objects.get_or_create(
            code="cleaning",
            defaults={
                "category": cleaning_category,
                "type": OfferingType.SERVICE_REQUEST,
                # Убирать будут в номере гостя — спрашивать локацию незачем.
                "location_mode": LocationMode.ROOM,
                "title": {"ru": "Уборка номера", "en": "Room cleaning"},
                "description": {
                    "ru": "Придём в удобное время",
                    "en": "We will come at a convenient time",
                },
                "price": None,
                "sort_order": 0,
            },
        )
        if created:
            self._attach_image(cleaning, "default", "Уборка")
            self._seed_request_fields(
                cleaning,
                [
                    ("when", "Когда убрать", "When", FieldType.TIME, True, {}, None, None, []),
                    ("comment", "Пожелания", "Notes", FieldType.TEXT, False,
                     {"ru": "Например: не трогать вещи на столе"}, None, None, []),
                ],
            )

    def _seed_bar_menu(self, points: dict[str, ExecutionPoint]):
        """
        Своя карта бару.

        До этого «Лобби-бар» стоял на парадной с подписью «Коктейли и вино» и
        ПУСТЫМ меню: напитки принадлежали ресторану, а всё, что гость видел в
        баре, приносили автотесты. Заведение без содержимого — дыра, которую
        гость встречает первым же тапом.
        """
        bar_point = points.get("bar")
        if bar_point is None:
            return

        category, _ = Category.objects.get_or_create(
            code="bar-cocktails",
            defaults={
                "type": OfferingType.PRODUCT,
                "title": {"ru": "Коктейли", "en": "Cocktails"},
                "sort_order": 0,
                "image": self._image_for("bar-drinks", "Барная карта"),
            },
        )
        Route.objects.get_or_create(
            category=category, execution_point=bar_point, defaults={"priority": 0}
        )

        for order, (code, ru, en, price, desc) in enumerate(
            [
                ("negroni", "Негрони", "Negroni", 78000,
                 {"ru": "Джин, кампари, красный вермут", "en": "Gin, Campari, sweet vermouth"}),
                ("aperol", "Апероль-шприц", "Aperol spritz", 69000,
                 {"ru": "Апероль, просекко, содовая", "en": "Aperol, prosecco, soda"}),
                ("mojito-zero", "Мохито без алкоголя", "Zero-proof mojito", 52000,
                 {"ru": "Лайм, мята, содовая", "en": "Lime, mint, soda"}),
            ]
        ):
            item, created = Item.objects.get_or_create(
                code=code,
                defaults={
                    "category": category,
                    "type": OfferingType.PRODUCT,
                    "title": {"ru": ru, "en": en},
                    "description": desc,
                    "price": price,
                    "sort_order": order,
                },
            )
            if created or not item.images.exists():
                # У каждой позиции свой снимок из манифеста: `_attach_image`
                # ищет ключ по КОДУ позиции, и «одолжить» чужой кадр здесь
                # нельзя — да и не нужно, у каждого напитка он свой.
                self._attach_image(item, category.code, ru)

    def _link_categories_to_services(self):
        """
        Привязать наполнение к сервису: category.service = сервис исполнителя,
        на которого категория замаршрутизирована. Инфо-категория без маршрута
        остаётся без сервиса. Идемпотентно (уже привязанные пропускаем).
        """
        services_by_ep = {s.execution_point_id: s.id for s in Service.objects.all()}
        for category in Category.objects.filter(service__isnull=True):
            route = (
                Route.objects.filter(category=category, is_active=True)
                .order_by("priority")
                .first()
            )
            if route is None:
                continue
            service_id = services_by_ep.get(route.execution_point_id)
            if service_id is not None:
                Category.objects.filter(pk=category.pk).update(service_id=service_id)

    def _seed_service_category(
        self, *, code: str, title: dict, point: ExecutionPoint, sort_order: int, schedule: Schedule
    ) -> Category:
        category, _ = Category.objects.get_or_create(
            code=code,
            defaults={
                "type": OfferingType.SERVICE_REQUEST,
                "title": title,
                "sort_order": sort_order,
                "schedule": schedule,
                "image": self._image_for(code, title.get("ru", code)),
            },
        )
        Route.objects.get_or_create(
            category=category, execution_point=point, defaults={"priority": 0}
        )
        return category

    def _seed_request_fields(self, item: Item, specs):
        for order, (code, ru, en, field_type, required, help_text, minimum, maximum, options) in enumerate(specs):
            RequestField.objects.get_or_create(
                item=item,
                code=code,
                defaults={
                    "label": {"ru": ru, "en": en},
                    "help_text": help_text,
                    "field_type": field_type,
                    "is_required": required,
                    "min_value": minimum,
                    "max_value": maximum,
                    "options": options,
                    "sort_order": order,
                },
            )

    # --- Уведомления и эскалация ------------------------------------------

    def _seed_notifications(self, points: dict[str, ExecutionPoint], users: dict[str, User]):
        """
        Канал и правило подъёма для кухни.

        Тип канала — `log`: демо-стенд не должен требовать бота и SMTP, чтобы
        показать, как работает эскалация. Сообщения видно в логах backend.
        """
        kitchen_chat, _ = NotificationChannel.objects.get_or_create(
            title="Чат кухни",
            defaults={
                "type": ChannelType.LOG,
                "execution_point": points["kitchen"],
                "templates": {
                    "ru": {
                        "subject": "Заявка №{{number}} — {{point}}",
                        "body": "{{room}}\n{{summary}}\n{{comment}}",
                    },
                    "en": {
                        "subject": "Order #{{number}} — {{point}}",
                        "body": "{{room}}\n{{summary}}\n{{comment}}",
                    },
                },
            },
        )

        chef = users.get("chef")
        if chef is not None:
            NotificationChannel.objects.get_or_create(
                title="Пётр — личный канал",
                defaults={
                    "type": ChannelType.LOG,
                    "user": chef,
                    "templates": {
                        "ru": {
                            "subject": "Заявку №{{number}} никто не взял",
                            "body": "{{point}} · {{room}}\n{{summary}}",
                        }
                    },
                },
            )

        rule, created = EscalationRule.objects.get_or_create(
            name="Кухня: подъём по смене",
            defaults={"execution_point": points["kitchen"]},
        )
        if created:
            # Короткие тайминги — чтобы демо было видно за минуты, а не за час.
            steps = [
                (0, TargetKind.POINT, "Сразу — в чат кухни"),
                (5, TargetKind.LEAD, "Через 5 минут — старшему смены"),
                (15, TargetKind.MANAGER, "Через 15 минут — руководителю"),
            ]
            for index, (delay, target, title) in enumerate(steps):
                EscalationStep.objects.create(
                    rule=rule,
                    sort_order=index,
                    delay_minutes=delay,
                    target_kind=target,
                    title=title,
                )

        self._seed_service_escalation(points, users)

    def _seed_service_escalation(self, points, users) -> None:
        """
        Эскалация на уровне сервиса (R3): у каждого заведения своё правило, и
        «дольше нормы» — это его собственный SLA, а не общее число.

        Норма разная по существу работы: кухня отдаёт за 20 минут, хозслужба
        приходит в номер за 45, консьерж отвечает за 10. Поэтому ступень
        «поднять управляющему» встаёт ровно на `sla_minutes` точки.

        Каналом управляющего эскалация и заканчивается: выше него внутри
        сервиса никого нет, а тревожить админа отеля каждой невзятой заявкой —
        верный способ, чтобы он перестал их читать.
        """
        for code, point in points.items():
            if code == "kitchen":
                continue  # у кухни своё демо-правило с короткими таймингами

            title = translate(point.title, "ru") or point.code
            NotificationChannel.objects.get_or_create(
                title=f"Чат: {title}",
                defaults={
                    "type": ChannelType.LOG,
                    "execution_point": point,
                    "templates": {
                        "ru": {
                            "subject": "Новая задача №{{number}} — {{point}}",
                            "body": "{{room}}\n{{summary}}\n{{comment}}",
                        },
                        "en": {
                            "subject": "New task #{{number}} — {{point}}",
                            "body": "{{room}}\n{{summary}}\n{{comment}}",
                        },
                    },
                },
            )

            rule, created = EscalationRule.objects.get_or_create(
                name=f"{title}: подъём по норме",
                defaults={"execution_point": point},
            )
            if created:
                for index, (delay, target, step_title) in enumerate(
                    [
                        (0, TargetKind.POINT, "Сразу — в чат отдела"),
                        (
                            point.sla_minutes,
                            TargetKind.MANAGER,
                            f"Через {point.sla_minutes} мин — управляющему сервисом",
                        ),
                    ]
                ):
                    EscalationStep.objects.create(
                        rule=rule,
                        sort_order=index,
                        delay_minutes=delay,
                        target_kind=target,
                        title=step_title,
                    )

        # Личный канал каждому управляющему: без него ступень MANAGER находит
        # нужного человека, но отправить ему нечего — в журнале «skipped».
        for prefix, user in users.items():
            if not prefix.startswith("manager."):
                continue
            NotificationChannel.objects.get_or_create(
                title=f"{user.full_name} — личный канал",
                defaults={
                    "type": ChannelType.LOG,
                    "user": user,
                    "templates": {
                        "ru": {
                            "subject": "Задача №{{number}} висит дольше нормы",
                            "body": "{{point}} · {{room}}\n{{summary}}",
                        },
                        "en": {
                            "subject": "Task #{{number}} is overdue",
                            "body": "{{point}} · {{room}}\n{{summary}}",
                        },
                    },
                },
            )

    # --- Инфо-страницы и бронь --------------------------------------------

    def _seed_info_pages(self):
        """Тип info: страница только для чтения, без заказа."""
        info_cat, _ = Category.objects.get_or_create(
            code="info",
            defaults={
                "type": OfferingType.INFO,
                "title": {"ru": "Об отеле", "en": "About"},
                "sort_order": 20,
            },
        )
        Item.objects.get_or_create(
            code="wifi",
            defaults={
                "category": info_cat,
                "type": OfferingType.INFO,
                "location_mode": LocationMode.NONE,
                "title": {"ru": "Wi-Fi и интернет", "en": "Wi-Fi & internet"},
                "description": {"ru": "Как подключиться", "en": "How to connect"},
                "price": None,
                "content": {
                    "ru": "## Сеть\nCrystal-Guest\n\n**Пароль:** welcome12345\n\n"
                          "Интернет бесплатный на всей территории отеля.",
                    "en": "## Network\nCrystal-Guest\n\n**Password:** welcome12345\n\n"
                          "Wi-Fi is free across the hotel.",
                },
                "sort_order": 0,
            },
        )
        Item.objects.get_or_create(
            code="about",
            defaults={
                "category": info_cat,
                "type": OfferingType.INFO,
                "location_mode": LocationMode.NONE,
                "title": {"ru": "О нашем отеле", "en": "About our hotel"},
                "price": None,
                "content": {
                    "ru": "Отель «Кристалл» — пять звёзд у моря.\nЗавтрак 07:00–11:00, "
                          "SPA до 22:00, ресепшен круглосуточно.",
                    "en": "Crystal Hotel — five stars by the sea.",
                },
                "sort_order": 1,
            },
        )

    def _seed_slot_resources(self, points, schedules):
        """Тип slot: бронируемый ресурс с рабочими часами и вместимостью."""
        spa_cat, _ = Category.objects.get_or_create(
            code="spa",
            defaults={
                "type": OfferingType.SLOT,
                "title": {"ru": "SPA и массаж", "en": "SPA & massage"},
                "sort_order": 21,
            },
        )
        massage, created = Item.objects.get_or_create(
            code="massage",
            defaults={
                "category": spa_cat,
                "type": OfferingType.SLOT,
                "location_mode": LocationMode.NONE,
                "title": {"ru": "Массаж 60 минут", "en": "Massage 60 min"},
                "description": {"ru": "Классический массаж", "en": "Classic massage"},
                "price": 350000,
                "sort_order": 0,
            },
        )
        Route.objects.get_or_create(
            category=spa_cat, execution_point=points["spa"], defaults={"priority": 0}
        )
        # Слоты нарезаются по интервалам расписания, поэтому SPA нужны реальные
        # рабочие часы, а не «круглосуточно» без интервалов. Конфиг заводим
        # идемпотентно — вне ветки created, чтобы --force его чинил.
        spa_hours, made = Schedule.objects.get_or_create(name="SPA 10:00–20:00")
        if made:
            for weekday in range(7):
                ScheduleInterval.objects.create(
                    schedule=spa_hours,
                    weekday=weekday,
                    start_time=time(10, 0),
                    end_time=time(20, 0),
                )
        SlotConfig.objects.update_or_create(
            item=massage,
            defaults={
                "duration_minutes": 60,
                "capacity": 2,
                "schedule": spa_hours,
                "execution_point": points["spa"],
                "lead_minutes": 30,
                "horizon_days": 14,
            },
        )

    # --- Чат и отзывы -----------------------------------------------------

    def _seed_chat_and_reviews(self, points, with_history: bool = False):
        """
        Пара сообщений в треде всегда, и — по флагу — завершённая заявка с
        отзывом. Сама заявка занимает номер заказа №1, поэтому создаётся только
        при --with-guest-history: тесты витрины ждут, что их первый заказ — №1.
        """
        from django.utils import timezone

        from apps.accounts.models import GuestSession, TrustLevel
        from apps.catalog.models import Item
        from apps.chat.models import ChatMessage, ChatThread
        from apps.orders.services import OrderInput, OrderLineInput, change_status, create_order
        from apps.reviews.models import Review

        room = Room.objects.filter(number="305").first()
        if room is None:
            return

        # Гостевая сессия для демо-данных.
        raw, token_hash = GuestSession.issue_token()
        session = GuestSession.objects.filter(room=room).order_by("-created_at").first()
        if session is None:
            session = GuestSession.objects.create(
                room=room,
                token_hash=token_hash,
                trust=TrustLevel.ROOM_SCANNED,
                expires_at=GuestSession.default_expiry(),
            )

        thread, _ = ChatThread.objects.get_or_create(
            room=room,
            defaults={"guest_session": session, "execution_point": points.get("concierge")},
        )
        if not thread.messages.exists():
            ChatMessage.objects.create(
                hotel_id=thread.hotel_id, thread=thread, author_type="guest",
                author_name="Гость", body="Добрый день! Во сколько завтрак?",
            )
            msg = ChatMessage.objects.create(
                hotel_id=thread.hotel_id, thread=thread, author_type="staff",
                author_name="Анна, консьерж", body="Здравствуйте! Завтрак с 07:00 до 11:00.",
            )
            ChatThread.objects.filter(pk=thread.pk).update(last_message_at=msg.created_at)

        # Завершённая заявка с отзывом — только по флагу (сдвигает нумерацию).
        caesar = Item.objects.filter(code="caesar").first()
        if with_history and caesar and not Review.objects.exists():
            order = create_order(
                OrderInput(lines=[OrderLineInput(item_id=str(caesar.pk))], room_id=str(room.pk)),
                guest_session=session,
            )
            change_status(order, to_code="done", actor_type="staff")
            order.refresh_from_db()
            Review.objects.create(
                hotel_id=order.hotel_id, order=order, guest_session=session,
                rating=5, comment="Очень вкусно, спасибо!",
            )

    def _seed_analytics_history(self, hotel, points, rooms, users):
        """
        Несколько недель правдоподобной истории: разные типы/отделы/статусы/
        отмены/отзывы и разброс по часам и дням. Даты проставляем задним числом,
        затем восстанавливаем журнал аналитики из заказов и пересчитываем —
        так дашборд наполнен, а числа получены тем же редьюсером, что и живьём.
        """
        from datetime import timedelta

        from apps.accounts.models import GuestSession, TrustLevel
        from apps.analytics.recompute import rebuild_raw_from_orders, recompute_aggregates
        from apps.catalog.models import Item
        from apps.orders.models import Order, OrderStatusChange
        from apps.orders.services import OrderInput, OrderLineInput, change_status, create_order
        from apps.reviews.models import Review

        # По одному живому предложению на тип, что реально создаёт заказ.
        offerings = [
            it for it in (
                Item.objects.filter(type="product", is_active=True).first(),
                Item.objects.filter(type="service_request", is_active=True).first(),
            ) if it is not None
        ]
        if not offerings or not rooms:
            return

        staff = list(users.values())
        trusts = [TrustLevel.ROOM_SCANNED, TrustLevel.ANONYMOUS, TrustLevel.PMS_VERIFIED]
        agents = [
            "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0) Mobile",
            "Mozilla/5.0 (iPad; CPU OS 16_0) Tablet",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Desktop",
        ]
        languages = ["ru", "en", "ar", "zh"]
        base = hotel.local_now().replace(hour=12, minute=0, second=0, microsecond=0)

        n = 0
        # 21 день истории; в день — переменное число заказов с разбросом по часам.
        for days_ago in range(21, 0, -1):
            day_anchor = base - timedelta(days=days_ago)
            per_day = 2 + (days_ago % 3)  # 2..4 заказа/день
            for k in range(per_day):
                item = offerings[(days_ago + k) % len(offerings)]
                room = rooms[(days_ago * 2 + k) % len(rooms)]
                created = day_anchor + timedelta(hours=(k * 4) - 6, minutes=(days_ago * 7) % 60)

                # Хэш токена детерминирован НАМЕРЕННО (демо воспроизводимо),
                # поэтому создаём через get_or_create: до R4 повторный
                # `--force` на существующем отеле падал здесь на уникальном
                # индексе, и пересеять стенд можно было только пересозданием БД.
                session, _ = GuestSession.objects.get_or_create(
                    token_hash=GuestSession.hash_token(f"seed-{hotel.subdomain}-{days_ago}-{k}"),
                    defaults={
                        "hotel_id": hotel.pk,
                        "room": room,
                        "trust": trusts[n % len(trusts)],
                        "language": languages[n % len(languages)],
                        "user_agent": agents[n % len(agents)],
                        "expires_at": GuestSession.default_expiry(),
                    },
                )
                GuestSession.objects.filter(pk=session.pk).update(created_at=created)
                session.refresh_from_db()

                try:
                    order = create_order(
                        OrderInput(
                            lines=[OrderLineInput(item_id=str(item.pk), quantity=1 + (k % 2))],
                            room_id=str(room.pk),
                            field_values=self._demo_field_values(item),
                        ),
                        guest_session=session,
                    )
                except DomainError as exc:
                    # Демо-история — украшение, а не условие существования отеля.
                    # Отель мог настроить минимум заказа или стоп-лист так, что
                    # конкретная строка истории не проходит: пропускаем её, а не
                    # роняем создание отеля целиком.
                    self.stdout.write(f"История: заказ пропущен ({exc})")
                    continue
                Order.objects.filter(pk=order.pk).update(created_at=created)
                OrderStatusChange.objects.filter(order_id=order.pk, from_status__isnull=True).update(created_at=created)
                order.refresh_from_db()

                # Коды статусов берём ИЗ ПОТОКА ЗАКАЗА, а не из доски ресторана:
                # история копится по всем отделам, а у хозслужбы, спа и
                # консьержа с R3 свои потоки — «accepted» там просто нет.
                flow = order.status.flow
                cancelled_code = status_flows.cancelled_status(flow).code
                working_code = status_flows.first_working_status(flow, order.status.sort_order).code
                done_code = status_flows.terminal_status(flow).code

                # Каждый седьмой — отмена; остальные проходят приёмку и завершение.
                if n % 7 == 6:
                    change_status(order, to_code=cancelled_code, actor_type="staff")
                    OrderStatusChange.objects.filter(order_id=order.pk, to_status__code=cancelled_code).update(
                        created_at=created + timedelta(minutes=8)
                    )
                else:
                    actor = staff[n % len(staff)]
                    Order.objects.filter(pk=order.pk).update(
                        assignee=actor, accepted_at=created + timedelta(minutes=3 + (n % 5))
                    )
                    change_status(order, to_code=working_code, actor_type="staff", actor_id=actor.pk)
                    OrderStatusChange.objects.filter(order_id=order.pk, to_status__code=working_code).update(
                        created_at=created + timedelta(minutes=3 + (n % 5))
                    )
                    change_status(order.__class__.objects.get(pk=order.pk), to_code=done_code, actor_type="staff", actor_id=actor.pk)
                    OrderStatusChange.objects.filter(order_id=order.pk, to_status__code=done_code).update(
                        created_at=created + timedelta(minutes=20 + (n % 30))
                    )
                    # Часть завершённых — с отзывом (разброс оценок, включая низкие).
                    if n % 3 == 0 and not Review.all_objects.filter(order_id=order.pk).exists():
                        rating = 5 if n % 5 else 2
                        review = Review.objects.create(
                            hotel_id=hotel.pk, order_id=order.pk, guest_session=session,
                            rating=rating, comment="Демо-отзыв",
                        )
                        Review.objects.filter(pk=review.pk).update(created_at=created + timedelta(minutes=40))
                n += 1

        # Журнал из заказов + пересчёт: наполнение получено тем же редьюсером.
        rebuild_raw_from_orders(hotel.pk)
        recompute_aggregates(hotel.pk)
        self.stdout.write(f"  история аналитики: {n} заказов")

    def _demo_field_values(self, item) -> dict:
        """Значения обязательных полей заявки — чтобы service_request прошёл валидацию."""
        from datetime import date as _date

        values: dict = {}
        for field in item.request_fields.all():
            ftype = field.field_type
            if ftype == "select":
                options = field.options or []
                if options:
                    values[field.code] = str(options[0].get("value"))
            elif ftype in ("number", "count"):
                values[field.code] = str(field.min_value if field.min_value is not None else 1)
            elif ftype == "date":
                values[field.code] = _date.today().isoformat()
            elif ftype == "time":
                values[field.code] = "12:00"
            else:
                values[field.code] = "Демо"
        return values

    # --- Медиа ------------------------------------------------------------

    def _image_for(self, code: str, label: str) -> MediaAsset | None:
        """
        Настоящая фотография из манифеста (apps/media/seed_photos.py), залитая
        ТЕМ ЖЕ медиапайплайном, что и загрузка из CMS.

        До R4 здесь рисовалась процедурная обложка с пометкой «фотографию негде
        взять офлайн». Теперь снимки лежат в кэше, и офлайн — это про кэш, а не
        про рисование.

        Ни снимка, ни MinIO — обходимся без картинки: демо-данные не должны
        быть причиной, по которой не поднимается окружение.
        """
        from apps.media import seed_photos

        content = seed_photos.fetch(code)
        if content is None:
            self.stdout.write(
                self.style.WARNING(
                    f"Фото для '{code}' недоступно — позиция останется без снимка. "
                    "Прогоните: manage.py fetch_seed_photos"
                )
            )
            return None

        try:
            from apps.media.services import upload_asset

            return upload_asset(
                content=content,
                filename=f"{code}.jpg",
                kind=MediaAsset.Kind.CATEGORY,
                content_type="image/jpeg",
                alt=seed_photos.alt_text(code) or {"ru": label},
            )
        except Exception as exc:  # noqa: BLE001 — MinIO необязателен для старта
            self.stdout.write(
                self.style.WARNING(f"Медиа для '{code}' пропущено ({exc})")
            )
            return None

    def _attach_image(self, item: Item, category_code: str, label: str):
        # Ключ манифеста — код ПОЗИЦИИ: одно и то же блюдо в разных разделах
        # должно получать одну и ту же фотографию.
        asset = self._image_for(item.code, label)
        if asset is not None:
            ItemImage.objects.get_or_create(item=item, asset=asset, defaults={"sort_order": 0})

    def _seed_hotel_cover(self, hotel):
        """
        Обложка отеля — парадная главной у гостя (R5). Живёт в токенах бренда
        («Бренд и витрина», R4) как фон вида `image`.
        """
        from apps.hotels.brand_services import get_or_create_brand

        theme = get_or_create_brand(hotel)
        tokens = dict(theme.tokens or {})
        brand = dict(tokens.get("brand") or {})
        background = dict(brand.get("background") or {})
        current = background.get("imageUrl") or ""
        # Заглушка в токенах — это НЕ настроенная обложка: считаем её
        # отсутствием и перезаписываем настоящим снимком.
        if background.get("kind") == "image" and current and "placeholder" not in current:
            return

        asset = self._image_for("hotel-cover", hotel.name)
        if asset is None:
            return

        # Обложка хранится в токенах бренда СТРОКОЙ url, а не ссылкой на ассет,
        # поэтому её нельзя записать, пока медиапайплайн не нарезал варианты:
        # `image_url` вернул бы заглушку, и она осела бы в бренде навсегда.
        # Дорезаем синхронно и берём НАСТОЯЩИЙ url — у ассета, а не через
        # резолвер с фолбэком.
        from apps.media.tasks import process_media_asset

        try:
            process_media_asset.apply(args=(str(asset.pk), str(hotel.pk))).get()
        except Exception as exc:  # noqa: BLE001 — MinIO необязателен для старта
            self.stdout.write(self.style.WARNING(f"Обложка отеля не нарезана ({exc})"))
            return

        asset.refresh_from_db()
        url = asset.url("card")
        if not url:
            self.stdout.write("Обложка отеля ещё не готова — пропускаю")
            return
        background.update({"kind": "image", "imageUrl": url, "dim": 0.15})
        brand["background"] = background
        tokens["brand"] = brand
        theme.tokens = tokens
        theme.save(update_fields=["tokens", "updated_at"])

    def _ensure_category_photos(self):
        """
        Раздел меню тоже виден гостю. В R4 аудит их не покрывал — часть осталась
        с процедурной обложкой, часть без фото вовсе.
        """
        from apps.media import seed_photos

        for category in Category.objects.select_related("image"):
            if category.code not in seed_photos.PHOTOS:
                continue
            if category.image_id and category.image.content_type == "image/jpeg":
                continue
            label = (category.title or {}).get("ru") or category.code
            asset = self._image_for(category.code, label)
            if asset is not None:
                category.image = asset
                category.save(update_fields=["image", "updated_at"])

    def _ensure_item_photos(self):
        """
        У каждой позиции — настоящая фотография.

        Две задачи разом: добить тех, кто заводился в обход `_attach_image`
        (инфо-страницы, бронируемые ресурсы), и ЗАМЕНИТЬ процедурные обложки
        R1/R2 — ради этого прогон и затевался. Признак процедурной: она PNG,
        настоящие снимки манифеста приходят JPEG.
        """
        from apps.media import seed_photos

        real = set(
            ItemImage.objects.filter(asset__content_type="image/jpeg").values_list(
                "item_id", flat=True
            )
        )
        for item in Item.objects.all():
            if item.pk in real or item.code not in seed_photos.PHOTOS:
                continue
            label = (item.title or {}).get("ru") or item.code
            asset = self._image_for(item.code, label)
            if asset is None:
                continue
            # Старую связку убираем жёстко: это служебная строка, и держать
            # рядом настоящее фото и нарисованную заглушку незачем.
            ItemImage.objects.filter(item=item).hard_delete()
            ItemImage.objects.create(item=item, asset=asset, sort_order=0)

    def _seed_venue_covers(self):
        """
        Обложка каждому заведению — включая служебные.

        Хозслужбу гость не видит, но админ видит её карточку в CMS, и «серый
        прямоугольник вместо фото» там читается ровно так же плохо.
        """
        for service in Service.objects.select_related("execution_point", "image"):
            # Процедурную обложку R1/R2 (PNG) считаем отсутствующей: её и
            # пришли заменить настоящим снимком.
            if service.image_id is not None and service.image.content_type == "image/jpeg":
                continue
            label = (service.public_name or {}).get("ru") or service.code
            asset = self._image_for(_venue_photo_code(service.code), label)
            if asset is not None:
                service.image = asset
                service.save(update_fields=["image", "updated_at"])

    def _seed_marketing_badges(self):
        """Пресеты бейджей и пара назначений — идемпотентно по коду пресета."""
        from apps.catalog.models import Badge, Item, ItemBadge

        presets = [
            ("hit", {"ru": "Хит", "en": "Hit"}, Badge.ColorRole.ACCENT, 0),
            ("new", {"ru": "Новинка", "en": "New"}, Badge.ColorRole.INFO, 1),
            ("chef_choice", {"ru": "Выбор шефа", "en": "Chef's choice"}, Badge.ColorRole.GOLD, 2),
            ("recommended", {"ru": "Рекомендуем", "en": "Recommended"}, Badge.ColorRole.SUCCESS, 3),
        ]
        badges = {}
        for code, label, role, order in presets:
            badge, _ = Badge.objects.get_or_create(
                preset=code,
                defaults={"label": label, "color_role": role, "sort_order": order},
            )
            badges[code] = badge

        # Демо-назначения: рибай — «Выбор шефа», цезарь — «Хит».
        for item_code, badge_code in (("ribeye", "chef_choice"), ("caesar", "hit")):
            item = Item.objects.filter(code=item_code).first()
            if item and badges.get(badge_code):
                ItemBadge.objects.get_or_create(
                    item=item, badge=badges[badge_code], defaults={"sort_order": 0}
                )

    def _seed_nutrition(self):
        """
        Демо-КБЖУ и состав для товарных позиций — карточка блюда показывает их.
        Числа детерминированы по коду (разнообразие без ручного подбора), состав
        берём из описания позиции.
        """
        import hashlib

        for item in Item.objects.filter(type="product"):
            if isinstance(item.attributes, dict) and item.attributes.get("nutrition"):
                continue
            seed = int(hashlib.sha1(item.code.encode("utf-8")).hexdigest(), 16)
            attrs = dict(item.attributes or {})
            attrs["nutrition"] = {
                "calories": 180 + seed % 420,
                "protein": 6 + seed % 30,
                "fat": 4 + (seed >> 3) % 28,
                "carbs": 5 + (seed >> 6) % 40,
                "portion": 180 + (seed >> 9) % 160,  # граммы — в строку КБЖУ
                # Состав НЕ копируем из описания: в карточке они стоят рядом, и
                # гость читал одну и ту же строку дважды. Пусто честнее копии —
                # настоящий состав отель заполняет сам в CMS.
                "composition": {"ru": ""},
            }
            item.attributes = attrs
            item.save(update_fields=["attributes", "updated_at"])

    def _seed_item_facets(self):
        """
        Демо-аллергены, маркеры и характеристики нескольким блюдам — карточка
        показывает янтарные «содержит», зелёные маркеры и пары характеристик.
        """
        from apps.catalog.models import (
            Allergen,
            DietaryMarker,
            ItemAllergen,
            ItemCharacteristic,
            ItemDietaryMarker,
        )

        allergens = {a.code: a for a in Allergen.objects.all()}
        markers = {m.code: m for m in DietaryMarker.objects.all()}

        facets: dict[str, dict] = {
            "ribeye": {
                "allergens": [], "markers": ["gluten_free", "halal"],
                "chars": [({"ru": "Способ приготовления", "en": "Cooking"}, {"ru": "Гриль", "en": "Grill"}),
                          ({"ru": "Вкус", "en": "Taste"}, {"ru": "Насыщенный", "en": "Rich"})],
            },
            "caesar": {
                "allergens": ["eggs", "fish", "milk", "gluten"], "markers": [],
                "chars": [({"ru": "Подача", "en": "Served"}, {"ru": "Холодная", "en": "Cold"})],
            },
            "carbonara": {
                "allergens": ["gluten", "eggs", "milk"], "markers": [],
                "chars": [({"ru": "Вкус", "en": "Taste"}, {"ru": "Сливочный", "en": "Creamy"})],
            },
            "syrniki": {
                "allergens": ["gluten", "eggs", "milk"], "markers": ["vegetarian"],
                "chars": [({"ru": "Подача", "en": "Served"}, {"ru": "Горячая", "en": "Hot"})],
            },
            "lemonade": {"allergens": [], "markers": ["vegan"], "chars": []},
            "greek-salad": {"allergens": ["milk"], "markers": ["vegetarian", "gluten_free"], "chars": []},
            "cappuccino": {"allergens": ["milk"], "markers": ["vegetarian"], "chars": []},
        }
        for code, spec in facets.items():
            item = Item.objects.filter(code=code).first()
            if item is None:
                continue
            for ac in spec["allergens"]:
                if ac in allergens:
                    ItemAllergen.objects.get_or_create(item=item, allergen=allergens[ac])
            for mc in spec["markers"]:
                if mc in markers:
                    ItemDietaryMarker.objects.get_or_create(item=item, marker=markers[mc])
            if not item.characteristics.exists():
                for order, (name, value) in enumerate(spec["chars"]):
                    ItemCharacteristic.objects.create(item=item, name=name, value=value, sort_order=order)

    # --- Наглядное наполнение (флаг --with-rich-catalog) --------------------
    # Всё ниже гоняется ТОЛЬКО с флагом и НЕ входит в тестовую фикстуру: объём и
    # генерация фото на каждый пере-сид были бы неподъёмны для набора тестов.

    def _seed_rich_catalog(self, hotel, points, locations, schedules):
        dinner = self._rich_schedule("Ресторан 12:00–23:00", time(12, 0), time(23, 0))
        bar_hours = self._rich_schedule("Бар 16:00–02:00", time(16, 0), time(2, 0))

        # Венью-часы существующим заведениям — витрина покажет «открыто до…».
        self._set_service_schedule("kitchen", schedules["kitchen"])
        self._set_service_schedule("bar", bar_hours)
        self._set_service_schedule("spa", Schedule.objects.filter(name="SPA 10:00–20:00").first())

        # Своя обложка каждому существующему заведению (не только через категорию)
        # и гарантия видимости на витрине.
        for code, label in [
            ("kitchen", "Панорама"), ("bar", "Лобби-бар"),
            ("spa", "СПА Кристалл"), ("concierge", "Консьерж"),
        ]:
            self._ensure_venue_cover(code, label)

        self._make_restaurant(
            code="terrace", public=("Терраса", "Terrace"),
            tagline=("Средиземноморье у моря", "Mediterranean by the sea"),
            schedule=dinner, locations=locations,
            categories=[
                ("terrace-starters", ("Закуски", "Starters"), [
                    ("bruschetta", ("Брускетта", "Bruschetta"), ("Томаты, базилик, чиабатта", "Tomato, basil, ciabatta"), 42000),
                    ("burrata", ("Буррата", "Burrata"), ("Крем-сыр буррата с песто", "Burrata with pesto"), 68000),
                    ("octopus", ("Осьминог гриль", "Grilled octopus"), ("С томлёным картофелем", "With confit potato"), 96000),
                ]),
                ("terrace-mains", ("Основные блюда", "Mains"), [
                    ("seabass", ("Сибас на гриле", "Grilled sea bass"), ("Целиком, с лимоном", "Whole, with lemon"), 128000),
                    ("truffle-risotto", ("Ризотто с трюфелем", "Truffle risotto"), ("Карнароли, пармезан", "Carnaroli, parmesan"), 89000),
                    ("lamb-rack", ("Каре ягнёнка", "Rack of lamb"), ("С розмарином и овощами", "Rosemary, vegetables"), 156000),
                ]),
                ("terrace-desserts", ("Десерты", "Desserts"), [
                    ("tiramisu", ("Тирамису", "Tiramisu"), ("Классический, маскарпоне", "Classic, mascarpone"), 39000),
                    ("pannacotta", ("Панна-котта", "Panna cotta"), ("С ягодным соусом", "Berry sauce"), 35000),
                ]),
            ],
        )
        self._make_restaurant(
            code="sakura", public=("Сакура", "Sakura"),
            tagline=("Японская кухня", "Japanese kitchen"),
            schedule=dinner, locations=locations,
            categories=[
                ("sakura-sushi", ("Суши и роллы", "Sushi & rolls"), [
                    ("philadelphia", ("Филадельфия", "Philadelphia"), ("Лосось, сливочный сыр", "Salmon, cream cheese"), 62000),
                    ("california", ("Калифорния", "California"), ("Краб, авокадо, икра", "Crab, avocado, roe"), 58000),
                    ("nigiri-set", ("Сет нигири", "Nigiri set"), ("8 шт., ассорти", "8 pcs, assorted"), 84000),
                    ("unagi", ("Унаги ролл", "Unagi roll"), ("Копчёный угорь, соус", "Smoked eel, sauce"), 69000),
                    ("spicy-tuna", ("Спайси тунец", "Spicy tuna"), ("Тунец, острый соус", "Tuna, spicy sauce"), 64000),
                    ("veggie-roll", ("Овощной ролл", "Veggie roll"), ("Авокадо, огурец", "Avocado, cucumber"), 42000),
                ]),
                ("sakura-hot", ("Горячее", "Hot dishes"), [
                    ("ramen", ("Рамен", "Ramen"), ("Свинина чашу, яйцо", "Chashu pork, egg"), 67000),
                    ("tempura", ("Темпура", "Tempura"), ("Креветки в кляре", "Battered shrimp"), 72000),
                    ("gyoza", ("Гёдза", "Gyoza"), ("Жареные пельмешки, 6 шт.", "Fried dumplings, 6 pcs"), 44000),
                ]),
                ("sakura-drinks", ("Напитки", "Drinks"), [
                    ("matcha", ("Матча латте", "Matcha latte"), ("На выбор молоко", "Choice of milk"), 38000),
                    ("sake", ("Саке", "Sake"), ("Тёплое, 150 мл", "Warm, 150 ml"), 52000),
                ]),
            ],
        )

        self._make_bar_menu(points["bar"], bar_hours, locations)
        self._make_room_service(schedules["all_day"], locations)
        self._expand_panorama()

        self._seed_nutrition()      # КБЖУ для новых товарных позиций (идемпотентно)
        self._seed_rich_facets()    # аллергены/маркеры части позиций

        hotel.showcase_group_threshold = 8  # все рестораны — отдельными плитками
        hotel.save(update_fields=["showcase_group_threshold", "updated_at"])
        self._seed_showcase_tiles()
        self._seed_rich_commerce(hotel)
        self._seed_modules()
        self._seed_inclusions()          # рум-сервис включает Панораму + часть бара
        self._seed_fanout_demo_order(hotel)  # демо-заказ, разъезжающийся на 2 трекера
        # Живая задача в каждый тип трекера. Под тем же флагом, что и остальной
        # наглядный контент: базовый сид держат тесты, и молча подкладывать им
        # заказы нельзя — половина проверок считает содержимое доски.
        self._seed_tracker_demo_tasks(points, list(Room.objects.order_by("number")))

    def _rich_schedule(self, name, start, end):
        schedule, created = Schedule.objects.get_or_create(name=name)
        if created:
            for weekday in range(7):
                ScheduleInterval.objects.create(
                    schedule=schedule, weekday=weekday, start_time=start, end_time=end
                )
        return schedule

    def _set_service_schedule(self, code, schedule):
        if schedule is not None:
            Service.objects.filter(code=code).update(schedule=schedule)

    def _ensure_venue_cover(self, code, label):
        service = Service.objects.filter(code=code).first()
        if service is None:
            return
        fields: list[str] = []
        if not service.is_guest_facing:
            service.is_guest_facing = True
            fields.append("is_guest_facing")
        if service.image_id is None:
            service.image = self._image_for(_venue_photo_code(code), label)
            fields.append("image")
        if fields:
            service.save(update_fields=[*fields, "updated_at"])

    def _rich_item(self, category, code, title, desc, price, sort_order, image_code):
        item, created = Item.objects.get_or_create(
            code=code,
            defaults={
                "category": category,
                "type": OfferingType.PRODUCT,
                "title": {"ru": title[0], "en": title[1]},
                "description": {"ru": desc[0], "en": desc[1]},
                "price": price,
                "sort_order": sort_order,
            },
        )
        if created:
            self._attach_image(item, image_code, title[0])
        return item

    def _make_restaurant(self, *, code, public, tagline, schedule, locations, categories):
        point, _ = ExecutionPoint.objects.get_or_create(
            code=code,
            defaults={
                "kind": ExecutionPoint.Kind.KITCHEN,
                "title": {"ru": public[0], "en": public[1]},
                "sla_minutes": 25,
            },
        )
        service, _ = Service.objects.get_or_create(
            execution_point=point,
            defaults={
                "code": point.code,
                "type": Service.Type.RESTAURANT,
                "public_name": {"ru": public[0], "en": public[1]},
                "tagline": {"ru": tagline[0], "en": tagline[1]},
                "is_guest_facing": True,
                "schedule": schedule,
                "image": self._image_for(code, public[0]),
            },
        )
        for order, (cat_code, cat_title, items) in enumerate(categories):
            category, _ = Category.objects.get_or_create(
                code=cat_code,
                defaults={
                    "type": OfferingType.PRODUCT,
                    "title": {"ru": cat_title[0], "en": cat_title[1]},
                    "sort_order": order,
                    "schedule": schedule,
                    "service": service,
                    "image": self._image_for(cat_code, cat_title[0]),
                },
            )
            Route.objects.get_or_create(
                category=category, execution_point=point, defaults={"priority": 0}
            )
            for location in locations:
                ServiceLocation.objects.get_or_create(
                    category=category, location=location,
                    defaults={"delivery_modes": [
                        ServiceLocation.DeliveryMode.DELIVERY, ServiceLocation.DeliveryMode.PICKUP
                    ]},
                )
            for i, (icode, ititle, idesc, price) in enumerate(items):
                self._rich_item(category, icode, ititle, idesc, price, i, cat_code)
        return service

    def _make_bar_menu(self, bar_point, schedule, locations):
        service = Service.objects.filter(execution_point=bar_point).first()
        if service is not None:
            service.schedule = schedule
            service.save(update_fields=["schedule", "updated_at"])
        category, _ = Category.objects.get_or_create(
            code="bar-drinks",
            defaults={
                "type": OfferingType.PRODUCT,
                "title": {"ru": "Коктейли и вино", "en": "Cocktails & wine"},
                "sort_order": 5, "schedule": schedule, "service": service,
                "image": self._image_for("bar-drinks", "Бар"),
            },
        )
        Route.objects.get_or_create(
            category=category, execution_point=bar_point, defaults={"priority": 0}
        )
        for location in locations:
            ServiceLocation.objects.get_or_create(
                category=category, location=location,
                defaults={"delivery_modes": [ServiceLocation.DeliveryMode.DELIVERY]},
            )
        drinks = [
            ("negroni", ("Негрони", "Negroni"), ("Джин, кампари, вермут", "Gin, campari, vermouth"), 52000),
            ("aperol", ("Апероль шприц", "Aperol spritz"), ("Апероль, просекко", "Aperol, prosecco"), 48000),
            ("mojito", ("Мохито", "Mojito"), ("Ром, мята, лайм", "Rum, mint, lime"), 46000),
            ("margarita", ("Маргарита", "Margarita"), ("Текила, лайм, трипл-сек", "Tequila, lime, triple sec"), 50000),
            ("wine-red", ("Бокал красного", "Glass of red"), ("Каберне совиньон", "Cabernet sauvignon"), 42000),
            ("wine-white", ("Бокал белого", "Glass of white"), ("Совиньон блан", "Sauvignon blanc"), 42000),
            ("old-fashioned", ("Олд фешен", "Old fashioned"), ("Бурбон, биттер, сахар", "Bourbon, bitters, sugar"), 56000),
            ("virgin-mojito", ("Безалкогольный мохито", "Virgin mojito"), ("Мята, лайм, содовая", "Mint, lime, soda"), 32000),
        ]
        for i, (icode, ititle, idesc, price) in enumerate(drinks):
            self._rich_item(category, icode, ititle, idesc, price, i, "bar-drinks")

    def _make_room_service(self, schedule, locations):
        point, _ = ExecutionPoint.objects.get_or_create(
            code="room_service",
            defaults={
                "kind": ExecutionPoint.Kind.KITCHEN,
                "title": {"ru": "Рум-сервис", "en": "Room service"},
                "sla_minutes": 40,
            },
        )
        service, _ = Service.objects.get_or_create(
            execution_point=point,
            defaults={
                "code": point.code,
                "type": Service.Type.ROOM_SERVICE,
                "public_name": {"ru": "Рум-сервис", "en": "Room service"},
                "tagline": {"ru": "Круглосуточно в номер", "en": "24/7 in-room"},
                "is_guest_facing": True,
                "schedule": schedule,
                "image": self._image_for("room_service", "Рум-сервис"),
            },
        )
        category, _ = Category.objects.get_or_create(
            code="room-service-menu",
            defaults={
                "type": OfferingType.PRODUCT,
                "title": {"ru": "В номер", "en": "In-room"},
                "sort_order": 6, "schedule": schedule, "service": service,
                "image": self._image_for("room-service-menu", "В номер"),
            },
        )
        Route.objects.get_or_create(
            category=category, execution_point=point, defaults={"priority": 0}
        )
        for location in locations:
            ServiceLocation.objects.get_or_create(
                category=category, location=location,
                defaults={"delivery_modes": [ServiceLocation.DeliveryMode.DELIVERY]},
            )
        items = [
            ("club-sandwich", ("Клубный сэндвич", "Club sandwich"), ("Курица, бекон, картофель фри", "Chicken, bacon, fries"), 62000),
            ("burger-rs", ("Бургер", "Burger"), ("Говядина, чеддер, соус", "Beef, cheddar, sauce"), 71000),
            ("caesar-rs", ("Цезарь в номер", "Caesar to room"), ("Курица, пармезан", "Chicken, parmesan"), 55000),
            ("soup-day", ("Суп дня", "Soup of the day"), ("Уточните у оператора", "Ask the operator"), 34000),
            ("fruit-plate", ("Фруктовая тарелка", "Fruit plate"), ("Сезонные фрукты", "Seasonal fruit"), 45000),
            ("breakfast-box", ("Завтрак в номер", "Breakfast box"), ("Яйца, тосты, кофе", "Eggs, toast, coffee"), 58000),
        ]
        for i, (icode, ititle, idesc, price) in enumerate(items):
            self._rich_item(category, icode, ititle, idesc, price, i, "room-service-menu")

    def _expand_panorama(self):
        extra = {
            "hot": [
                ("salmon-steak", ("Стейк из лосося", "Salmon steak"), ("С овощами гриль", "With grilled vegetables"), 118000),
                ("mushroom-soup", ("Крем-суп из белых грибов", "Porcini cream soup"), ("С трюфельным маслом", "Truffle oil"), 52000),
                ("duck-breast", ("Утиная грудка", "Duck breast"), ("С вишнёвым соусом", "Cherry sauce"), 134000),
                ("beef-stroganoff", ("Бефстроганов", "Beef stroganoff"), ("С картофельным пюре", "With mashed potato"), 98000),
            ],
            "salads": [
                ("burrata-salad", ("Салат с бурратой", "Burrata salad"), ("Томаты, руккола", "Tomato, arugula"), 74000),
                ("nicoise", ("Салат Нисуаз", "Niçoise"), ("Тунец, яйцо, оливки", "Tuna, egg, olives"), 66000),
                ("quinoa-salad", ("Салат с киноа", "Quinoa salad"), ("Овощи, авокадо", "Vegetables, avocado"), 58000),
            ],
            "drinks": [
                ("fresh-orange", ("Фреш апельсиновый", "Fresh orange juice"), ("Свежевыжатый", "Freshly squeezed"), 34000),
                ("espresso", ("Эспрессо", "Espresso"), ("Двойной", "Double"), 24000),
                ("green-tea", ("Зелёный чай", "Green tea"), ("Сенча", "Sencha"), 28000),
                ("iced-latte", ("Айс-латте", "Iced latte"), ("На выбор молоко", "Choice of milk"), 32000),
            ],
        }
        for cat_code, items in extra.items():
            category = Category.objects.filter(code=cat_code).first()
            if category is None:
                continue
            base = category.items.count()
            for i, (icode, ititle, idesc, price) in enumerate(items):
                self._rich_item(category, icode, ititle, idesc, price, base + i, cat_code)

    def _seed_rich_facets(self):
        from apps.catalog.models import Allergen, DietaryMarker, ItemAllergen, ItemDietaryMarker

        allergens = {a.code: a for a in Allergen.objects.all()}
        markers = {m.code: m for m in DietaryMarker.objects.all()}
        facets = {
            "seabass": {"allergens": ["fish"], "markers": ["gluten_free"]},
            "philadelphia": {"allergens": ["fish", "milk"], "markers": []},
            "california": {"allergens": ["crustaceans", "fish"], "markers": []},
            "burrata": {"allergens": ["milk"], "markers": ["vegetarian"]},
            "tempura": {"allergens": ["crustaceans", "gluten"], "markers": []},
            "salmon-steak": {"allergens": ["fish"], "markers": ["gluten_free"]},
            "burrata-salad": {"allergens": ["milk"], "markers": ["vegetarian", "gluten_free"]},
            "matcha": {"allergens": ["milk"], "markers": ["vegetarian"]},
            "fruit-plate": {"allergens": [], "markers": ["vegan", "gluten_free"]},
            "veggie-roll": {"allergens": [], "markers": ["vegan"]},
        }
        for code, spec in facets.items():
            item = Item.objects.filter(code=code).first()
            if item is None:
                continue
            for ac in spec["allergens"]:
                if ac in allergens:
                    ItemAllergen.objects.get_or_create(item=item, allergen=allergens[ac])
            for mc in spec["markers"]:
                if mc in markers:
                    ItemDietaryMarker.objects.get_or_create(item=item, marker=markers[mc])

    def _seed_showcase_tiles(self):
        from apps.hotels.models import ShowcaseTile

        tiles = [
            ("kitchen", "l", 0), ("terrace", "m", 1), ("sakura", "m", 2),
            ("bar", "m", 3), ("room_service", "s", 4), ("spa", "m", 5), ("info", "s", 9),
        ]
        for key, size, order in tiles:
            ShowcaseTile.objects.update_or_create(
                key=key, defaults={"size": size, "sort_order": order, "is_enabled": True}
            )

    def _seed_rich_commerce(self, hotel):
        # Отельные ставки — чтобы разбивка заказа была видна.
        hotel.service_fee_bp = 1000          # 10% сервисный сбор
        hotel.tip_presets = [5, 10, 15]
        hotel.free_delivery_threshold_minor = 300000  # бесплатная доставка от 3000 ₽
        hotel.save(update_fields=[
            "service_fee_bp", "tip_presets", "free_delivery_threshold_minor", "updated_at"
        ])
        # Наглядные per-service оверрайды поверх дефолтов отеля.
        Service.objects.filter(code="bar").update(service_fee_bp=0)          # в баре сбора нет
        Service.objects.filter(code="spa").update(service_fee_bp=0)
        Service.objects.filter(code="room_service").update(
            min_order_minor=50000, service_fee_bp=1500                       # минимум + выше сбор
        )

    def _seed_modules(self):
        from apps.hotels.models import HotelModule

        enabled = [
            (HotelModule.Code.MULTI_RESTAURANT, "tariff", {}),
            (HotelModule.Code.MARKETING, "tariff", {}),
            (HotelModule.Code.EXTRA_LANGUAGES, "tariff", {}),
            (HotelModule.Code.ANALYTICS_LEVEL, "tariff", {"level": "advanced"}),
            (HotelModule.Code.PMS, "override", {}),
        ]
        for code, source, config in enabled:
            HotelModule.objects.update_or_create(
                code=code, defaults={"is_enabled": True, "source": source, "config": config}
            )

    def _seed_inclusions(self):
        """
        Рум-сервис ВКЛЮЧАЕТ по ссылке: меню «Панорамы» целиком (+15% наценка,
        своё круглосуточное расписание, «Сырники» скрыты как завтрак-only) и
        коктейли бара (вино скрыто). Исполнители — кухня «Панорамы» и бар.
        Идемпотентно (пропускаем уже заведённые включения).
        """
        from apps.catalog.inclusions import create_inclusion
        from apps.catalog.models import Category, Item, ServiceInclusion

        rs = Service.objects.filter(code="room_service").first()
        kitchen = Service.objects.filter(code="kitchen").first()
        bar = Service.objects.filter(code="bar").first()
        if not (rs and kitchen and bar):
            return
        all_day = Schedule.objects.filter(is_always_open=True).first()

        if not ServiceInclusion.objects.filter(including_service=rs, source_service=kitchen).exists():
            hidden = list(
                Item.objects.filter(code="syrniki").values_list("id", flat=True)
            )
            create_inclusion(rs.pk, {
                "source_service_id": str(kitchen.pk),
                "scope": "all",
                "markup_kind": "percent",
                "markup_value": 1500,
                "schedule_id": str(all_day.pk) if all_day else None,
                "hidden_item_ids": [str(i) for i in hidden],
            })
        if not ServiceInclusion.objects.filter(including_service=rs, source_service=bar).exists():
            bar_cat = Category.objects.filter(code="bar-drinks").first()
            hidden = list(
                Item.objects.filter(code__in=["wine-red", "wine-white"]).values_list("id", flat=True)
            )
            create_inclusion(rs.pk, {
                "source_service_id": str(bar.pk),
                "scope": "categories",
                "category_ids": [str(bar_cat.pk)] if bar_cat else [],
                "hidden_item_ids": [str(i) for i in hidden],
            })

    def _seed_tracker_demo_tasks(self, points, rooms):
        """
        По живой задаче в КАЖДЫЙ тип трекера (R3): доска ресторана, очередь
        хозслужбы, лента записей спа, заявки консьержа.

        Задача — это обычный заказ, а не отдельная сущность: у ресторана она
        приходит корзиной, у хозслужбы и консьержа — заявкой с полями формы, у
        спа — бронью слота. Поэтому и сеются они одним и тем же create_order,
        которым пользуется витрина, — сид не должен уметь того, чего не умеет
        гость.

        Идемпотентно по точке: если на доске уже есть активная задача, второй
        раз не заводим.
        """
        from apps.accounts.models import GuestSession, TrustLevel
        from apps.catalog.models import Item
        from apps.orders.models import Order
        from apps.orders.services import OrderInput, OrderLineInput, create_order

        room = next((r for r in rooms if r.number == "305"), None) or (rooms[0] if rooms else None)
        if room is None:
            return

        _raw, token_hash = GuestSession.issue_token()
        session = GuestSession.objects.create(
            room=room, token_hash=token_hash, trust=TrustLevel.ROOM_SCANNED,
            expires_at=GuestSession.default_expiry(),
        )

        specs = [
            # точка, код позиции, ответы формы, комментарий
            ("kitchen", "caesar", {}, "Без сухариков, пожалуйста"),
            ("housekeeping", "cleaning", {"when": "14:00"}, "Свежие полотенца"),
            ("concierge", "taxi",
             {"destination": "Аэропорт Пулково", "when": "18:30", "passengers": 2}, ""),
        ]
        for point_code, item_code, field_values, comment in specs:
            point = points.get(point_code)
            item = Item.objects.filter(code=item_code).first()
            if point is None or item is None:
                continue
            if Order.objects.filter(
                execution_point=point, status__is_terminal=False
            ).exists():
                continue
            create_order(
                OrderInput(
                    lines=[OrderLineInput(item_id=str(item.pk))],
                    room_id=str(room.pk),
                    field_values=field_values,
                    comment=comment,
                ),
                guest_session=session,
            )

        self._seed_spa_demo_booking(points, room, session)

    def _seed_spa_demo_booking(self, points, room, session):
        """
        Запись в ленту спа — на СЕГОДНЯ: лента показывает день, и вчерашняя
        бронь оставила бы мастеру пустой экран.
        """
        from apps.catalog.models import Item, SlotConfig
        from apps.orders.models import Order
        from apps.orders.services import OrderInput, OrderLineInput, create_order

        spa = points.get("spa")
        massage = Item.objects.filter(code="massage").first()
        if spa is None or massage is None:
            return
        if Order.objects.filter(execution_point=spa, status__is_terminal=False).exists():
            return

        config = SlotConfig.objects.filter(item=massage).select_related("schedule").first()
        if config is None:
            return

        from apps.catalog import slots as slot_svc

        hotel = Hotel.objects.get(pk=spa.hotel_id)
        today = hotel.local_now().date().isoformat()
        available = slot_svc.available_slots(massage, today)["slots"]
        free = next((slot for slot in available if slot.get("available")), None)
        if free is None:
            # Сегодня спа уже закрыто (поздний прогон сида) — не выдумываем
            # бронь вне рабочих часов: доступность считает расписание, и
            # обходить его сидом значило бы сеять то, чего система не создаёт.
            self.stdout.write("Свободных слотов спа на сегодня нет — запись не завожу")
            return

        create_order(
            OrderInput(
                lines=[OrderLineInput(item_id=str(massage.pk))],
                room_id=str(room.pk),
                slot_start=free["starts_at"],
            ),
            guest_session=session,
        )

    def _seed_fanout_demo_order(self, hotel):
        """
        Демо-заказ в рум-сервисе: горячее «Панорамы» + коктейль бара → разъезд на
        два трекера (кухня + бар). Идемпотентно (по наличию parent-заказа
        рум-сервиса). Позиции без обязательных модификаторов, чтобы заказ прошёл.
        """
        from apps.accounts.models import GuestSession, TrustLevel
        from apps.catalog.models import Item
        from apps.orders.models import Order
        from apps.orders.services import OrderInput, OrderLineInput, create_order

        room = Room.objects.filter(number="201").first() or Room.objects.first()
        rs = Service.objects.filter(code="room_service").first()
        dish = Item.objects.filter(code="carbonara").first()      # кухня «Панорамы»
        cocktail = Item.objects.filter(code="negroni").first()    # бар
        if not (room and rs and dish and cocktail):
            return
        if Order.objects.filter(execution_point__code="room_service", parent__isnull=True).exists():
            return  # демо-заказ уже есть

        _raw, token_hash = GuestSession.issue_token()
        session = GuestSession.objects.create(
            room=room, token_hash=token_hash, trust=TrustLevel.ROOM_SCANNED,
            expires_at=GuestSession.default_expiry(),
        )
        create_order(
            OrderInput(
                lines=[OrderLineInput(item_id=str(dish.pk)), OrderLineInput(item_id=str(cocktail.pk))],
                service_code="room_service",
                room_id=str(room.pk),
            ),
            guest_session=session,
        )
