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
from apps.hotels.models import (
    BrandTheme,
    ExecutionPoint,
    Hotel,
    HotelLanguage,
    Location,
    Room,
    Schedule,
    ScheduleInterval,
)
from apps.media.models import CategoryPlaceholder, MediaAsset
from apps.notifications.models import (
    ChannelType,
    EscalationRule,
    EscalationStep,
    NotificationChannel,
    TargetKind,
)
from apps.orders.models import StatusDefinition

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

STATUS_PRESET = [
    # code, ru, en, initial, terminal, cancelled, токен цвета, отмена гостем
    ("new", "Новый", "New", True, False, False, "info", True),
    ("accepted", "Принят", "Accepted", False, False, False, "info", True),
    # С «Готовится» отмена уже закрыта: продукты в работе.
    ("preparing", "Готовится", "Preparing", False, False, False, "warning", False),
    ("on_the_way", "В пути", "On the way", False, False, False, "warning", False),
    ("done", "Доставлено", "Delivered", False, True, False, "success", False),
    ("cancelled", "Отменён", "Cancelled", False, True, True, "danger", False),
]

PLACEHOLDERS = [
    ("default", "Заглушка по умолчанию"),
    ("hot", "Горячее"),
    ("salads", "Салаты"),
    ("drinks", "Напитки"),
]


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

    def handle(self, *args, **options):
        history = options["with_guest_history"]
        self._seed_placeholders()
        self._seed_hotel(options["subdomain"], options["name"], options["force"], history)
        if options["with_second_hotel"]:
            self._seed_hotel("aurora", "Aurora Boutique Hotel", options["force"], history)
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
    def _seed_hotel(self, subdomain: str, name: str, force: bool, with_history: bool = False):
        hotel, created = Hotel.objects.get_or_create(
            subdomain=subdomain,
            defaults={
                "name": name,
                "timezone": "Europe/Moscow",
                "default_language": "ru",
                "currency": "RUB",
            },
        )
        if not created and not force:
            self.stdout.write(f"Отель '{subdomain}' уже существует — пропускаю")
            return

        with tenant_context(hotel):
            theme = self._seed_brand(hotel)
            self._seed_languages()
            points = self._seed_execution_points()
            kitchen = points["kitchen"]
            users = self._seed_staff(hotel, points)
            self._seed_statuses()
            rooms = self._seed_rooms()
            locations = self._seed_locations()
            schedules = self._seed_schedules()
            self._seed_catalog(kitchen, locations, schedules)
            self._seed_services(points, schedules)
            self._seed_info_pages()
            self._seed_slot_resources(points, schedules)
            self._seed_notifications(points, users)
            self._seed_chat_and_reviews(points, with_history)

            hotel.default_theme = theme
            hotel.save(update_fields=["default_theme", "updated_at"])

        self.stdout.write(
            self.style.SUCCESS(
                f"Отель '{subdomain}' готов: {len(rooms)} номеров, "
                f"локации {[loc.code for loc in locations]}"
            )
        )

    def _seed_brand(self, hotel: Hotel) -> BrandTheme:
        # Осмысленный стартовый пресет вместо голого набора: витрина сразу
        # выглядит цельно. Разным отелям — разные пресеты, чтобы изоляция
        # бренда была видна глазами (Crystal тёмный, Aurora бирюзовый).
        from apps.hotels.brand_library import preset_tokens

        preset = "tiffany_night" if hotel.subdomain == "aurora" else "evening_concierge"
        theme, _ = BrandTheme.objects.update_or_create(
            name=f"{hotel.name} — основная",
            defaults={"tokens": preset_tokens(preset), "is_preset": False},
        )
        return theme

    def _seed_languages(self):
        for order, (code, title, is_default) in enumerate(
            [
                ("ru", "Русский", True),
                ("en", "English", False),
                ("ar", "العربية", False),
                ("zh", "中文", False),
            ]
        ):
            HotelLanguage.objects.get_or_create(
                code=code,
                defaults={"title": title, "is_default": is_default, "sort_order": order},
            )

    def _seed_execution_points(self) -> dict[str, ExecutionPoint]:
        """
        Отделы отеля. Заявки-услуги уходят в свои: такси — консьержу, уборка —
        в хозслужбу. Это обычная работа Route, а не отдельная механика.
        """
        specs = [
            ("kitchen", ExecutionPoint.Kind.KITCHEN, "Кухня ресторана", "Restaurant kitchen", 20),
            ("bar", ExecutionPoint.Kind.BAR, "Лобби-бар", "Lobby bar", 15),
            ("concierge", ExecutionPoint.Kind.RECEPTION, "Консьерж", "Concierge", 10),
            ("housekeeping", ExecutionPoint.Kind.HOUSEKEEPING, "Хозслужба", "Housekeeping", 45),
            ("spa", ExecutionPoint.Kind.SPA, "SPA-центр", "SPA", 30),
        ]
        points: dict[str, ExecutionPoint] = {}
        for code, kind, ru, en, sla in specs:
            point, _ = ExecutionPoint.objects.get_or_create(
                code=code,
                defaults={"kind": kind, "title": {"ru": ru, "en": en}, "sla_minutes": sla},
            )
            points[code] = point
        return points

    def _seed_staff(self, hotel: Hotel, points: dict[str, ExecutionPoint]) -> dict[str, User]:
        """Каждому отделу — свой сотрудник: доски не должны пересекаться."""
        specs = [
            ("chef", "Пётр, повар", "kitchen", StaffAssignment.Level.LEAD),
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

    def _seed_statuses(self):
        for order, (
            code,
            ru,
            en,
            initial,
            terminal,
            cancelled,
            token,
            guest_cancel,
        ) in enumerate(STATUS_PRESET):
            StatusDefinition.objects.update_or_create(
                code=code,
                defaults={
                    "title": {"ru": ru, "en": en},
                    "sort_order": order,
                    "is_initial": initial,
                    "is_terminal": terminal,
                    "is_cancelled": cancelled,
                    "color_token": token,
                    "allows_guest_cancel": guest_cancel,
                },
            )

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
                "flags": ["chef_choice", "gluten_free"],
                "allergens": [],
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
                "flags": ["popular"],
                "allergens": ["eggs", "milk", "gluten", "fish"],
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
                "flags": ["vegan"],
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
                "flags": ["popular"],
                "allergens": ["gluten", "eggs", "milk"],
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
                "flags": ["vegetarian", "gluten_free"],
                "allergens": ["milk"],
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
                "flags": ["vegetarian"],
                "allergens": ["milk", "eggs", "gluten"],
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
                "allergens": ["milk"],
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

    # --- Медиа ------------------------------------------------------------

    def _image_for(self, code: str, label: str) -> MediaAsset | None:
        """
        Демо-картинка. Если MinIO недоступен — молча обходимся заглушкой:
        сид не должен падать из-за необязательной зависимости.
        """
        try:
            from apps.media.services import upload_asset

            content = _render_placeholder_png(label)
            return upload_asset(
                content=content,
                filename=f"{code}.png",
                kind=MediaAsset.Kind.CATEGORY,
                content_type="image/png",
                alt={"ru": label},
            )
        except Exception as exc:  # noqa: BLE001
            self.stdout.write(
                self.style.WARNING(f"Медиа для '{code}' пропущено ({exc}) — будет заглушка")
            )
            return None

    def _attach_image(self, item: Item, category_code: str, label: str):
        asset = self._image_for(f"{category_code}-{item.code}", label)
        if asset is not None:
            ItemImage.objects.get_or_create(item=item, asset=asset, defaults={"sort_order": 0})


def _render_placeholder_png(label: str) -> bytes:
    """Однотонный прямоугольник с подписью — нужен только чтобы пайплайн реально отработал."""
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (1200, 800), (15, 118, 110))
    draw = ImageDraw.Draw(image)
    draw.text((40, 40), label, fill=(255, 255, 255))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()
