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
    ModifierGroup,
    ModifierOption,
    OfferingType,
    Route,
    ServiceLocation,
)
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
    # code, ru, en, initial, terminal, cancelled, токен цвета
    ("new", "Новый", "New", True, False, False, "info"),
    ("accepted", "Принят", "Accepted", False, False, False, "info"),
    ("preparing", "Готовится", "Preparing", False, False, False, "warning"),
    ("on_the_way", "В пути", "On the way", False, False, False, "warning"),
    ("done", "Доставлено", "Delivered", False, True, False, "success"),
    ("cancelled", "Отменён", "Cancelled", False, True, True, "danger"),
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

    def handle(self, *args, **options):
        self._seed_placeholders()
        self._seed_hotel(options["subdomain"], options["name"], options["force"])
        if options["with_second_hotel"]:
            self._seed_hotel("aurora", "Aurora Boutique Hotel", options["force"])
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
    def _seed_hotel(self, subdomain: str, name: str, force: bool):
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
            kitchen = self._seed_execution_points()
            self._seed_staff(hotel, kitchen)
            self._seed_statuses()
            rooms = self._seed_rooms()
            locations = self._seed_locations()
            schedules = self._seed_schedules()
            self._seed_catalog(kitchen, locations, schedules)

            hotel.default_theme = theme
            hotel.save(update_fields=["default_theme", "updated_at"])

        self.stdout.write(
            self.style.SUCCESS(
                f"Отель '{subdomain}' готов: {len(rooms)} номеров, "
                f"локации {[loc.code for loc in locations]}"
            )
        )

    def _seed_brand(self, hotel: Hotel) -> BrandTheme:
        theme, _ = BrandTheme.objects.get_or_create(
            name=f"{hotel.name} — основная",
            defaults={"tokens": CRYSTAL_TOKENS, "is_preset": False},
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

    def _seed_execution_points(self) -> ExecutionPoint:
        kitchen, _ = ExecutionPoint.objects.get_or_create(
            code="kitchen",
            defaults={
                "kind": ExecutionPoint.Kind.KITCHEN,
                "title": {"ru": "Кухня ресторана", "en": "Restaurant kitchen"},
            },
        )
        ExecutionPoint.objects.get_or_create(
            code="bar",
            defaults={
                "kind": ExecutionPoint.Kind.BAR,
                "title": {"ru": "Лобби-бар", "en": "Lobby bar"},
            },
        )
        return kitchen

    def _seed_staff(self, hotel: Hotel, kitchen: ExecutionPoint):
        email = f"chef@{hotel.subdomain}.local"
        user = User.objects.filter(email=email).first()
        if user is None:
            user = User.objects.create_user(
                email=email,
                password="chef12345",
                hotel=hotel,
                full_name="Пётр, повар",
                language="ru",
                is_staff_member=True,
            )
        StaffAssignment.objects.get_or_create(
            user=user,
            execution_point=kitchen,
            defaults={"level": StaffAssignment.Level.LEAD},
        )

    def _seed_statuses(self):
        for order, (code, ru, en, initial, terminal, cancelled, token) in enumerate(
            STATUS_PRESET
        ):
            StatusDefinition.objects.get_or_create(
                code=code,
                defaults={
                    "title": {"ru": ru, "en": en},
                    "sort_order": order,
                    "is_initial": initial,
                    "is_terminal": terminal,
                    "is_cancelled": cancelled,
                    "color_token": token,
                },
            )

    def _seed_rooms(self) -> list[Room]:
        rooms = []
        for floor in ("2", "3", "4"):
            for index in ("01", "05", "12"):
                room, _ = Room.objects.get_or_create(
                    number=f"{floor}{index}",
                    defaults={"floor": floor, "source": Room.Source.MANUAL},
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
        for order, (code, ru, en, schedule) in enumerate(
            [
                ("hot", "Горячее", "Hot dishes", schedules["kitchen"]),
                ("salads", "Салаты", "Salads", schedules["kitchen"]),
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

        self._seed_items(categories)

    def _seed_items(self, categories: dict[str, Category]):
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
                "flags": ["chef-choice", "gluten-free"],
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
