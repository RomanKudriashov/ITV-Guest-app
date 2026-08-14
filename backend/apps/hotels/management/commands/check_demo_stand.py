"""
Проверка демо-стенда: на месте ли то, что показывают клиенту.

ЗАЧЕМ. Демо-отель — общий стенд, по которому ходят и прогоны, и показы. Прогон
за собой убирает, и уборка ошибается в одну сторону: лишнее удалит или выключит.
Заметить это глазами можно только на самом показе, и уже поздно. Команда
отвечает на единственный вопрос — «что именно исчезло» — и отвечает до того, как
вопрос задаст клиент.

КОГДА ГОНЯТЬ. После полного E2E и перед любым показом:

    docker compose exec backend python manage.py check_demo_stand

Ненулевой код возврата означает «стенд деградировал», и его можно вешать в CI
следующим шагом после прогона.

НА РАЗРАБОТЧЕСКОЙ МАШИНЕ команда будет краснеть на заказах и сессиях «Азура»
и «Люмена»: генератор активности локально обычно не гоняли. Это не ложная
тревога — контракт стенда включает живую активность, — но локально её проще
не заводить. Хотите только каталог демо-отеля: `--fleet-only` даёт обратное,
а обычный прогон без флота получают, гоняя команду с `--subdomain crystal` и
читая расхождения по флоту как ожидаемые.

ЧТО ЭТО НЕ ДЕЛАЕТ. Не чинит. Восстановление — идемпотентный сид:

    python manage.py seed_demo_hotel --subdomain crystal --force --with-rich-catalog

Разделять проверку и починку здесь важно: команда, которая молча дочиняет стенд,
скрывает сам факт деградации, а он и есть главная новость.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError

from apps.catalog.models import Category, Item
from apps.catalog.services.showcase import build_showcase
from apps.core.context import tenant_context
from apps.hotels.models import Hotel, Room, Service

# Договор демо-стенда: что обязано быть видно гостю на главной и с каким
# минимальным наполнением. Минимумы, а не точные числа: добавить в меню позицию
# — не поломка, а вот потерять раздел целиком — поломка.
#
# Набор ровно тот, что создаёт `seed_demo_hotel --with-rich-catalog`. Держать
# его здесь списком — сознательное повторение: проверка обязана знать ожидаемое
# независимо от того, что сейчас делает сид, иначе она перестанет ловить случай
# «сид изменили, и стенд тихо обеднел».
EXPECTED_VENUES = {
    "kitchen": {"title": "Панорама", "categories": 3, "items": 7},
    "terrace": {"title": "Терраса", "categories": 3, "items": 8},
    "sakura": {"title": "Сакура", "categories": 3, "items": 11},
    "bar": {"title": "Лобби-бар", "categories": 1, "items": 3},
    "room_service": {"title": "Рум-сервис", "categories": 1, "items": 6},
    "spa": {"title": "СПА", "categories": 1, "items": 1},
    "concierge": {"title": "Консьерж", "categories": 3, "items": 10},
}

# Служебные сервисы: активны, но гостю не показываются. Пропажу тоже замечаем —
# без хозслужбы не работает уборка номера.
EXPECTED_INTERNAL = {"housekeeping"}

# Контракт СТЕНДА ЦЕЛИКОМ, а не одного демо-отеля.
#
# Проверка знала только каталог «Кристалла» и потому отвечала «стенд цел» в тот
# самый день, когда я не смог найти на нём ни одного номера. Ошибка тогда была
# в моём запросе, но узкий контракт сделал её неотличимой от настоящей пропажи:
# зелёная проверка не противоречила «номеров нет», потому что про номера она
# ничего не знала.
#
# Минимумы, а не точные числа: генератор активности досыпает заказы от прогона
# к прогону, и «ровно 431» ломалось бы каждый день. Пропажу ловят нижние
# границы — их пересекают только при настоящей потере данных.
FLEET = {
    "crystal": {"rooms": 5, "orders": 50, "sessions": 50, "room_control": True},
    "azure": {"rooms": 5, "orders": 50, "sessions": 50, "room_control": False},
    "lumen": {"rooms": 5, "orders": 50, "sessions": 50, "room_control": False},
}


class Command(BaseCommand):
    help = "Проверить, что демо-стенд не обеднел: заведения, наполнение, витрина"

    def add_arguments(self, parser):
        parser.add_argument("--subdomain", default="crystal")
        parser.add_argument(
            "--fleet-only",
            action="store_true",
            help="Только наполнение трёх отелей, без разбора каталога демо-отеля",
        )

    def handle(self, *args, **options):
        subdomain = options["subdomain"]
        hotel = Hotel.all_objects.filter(subdomain=subdomain).first()
        if hotel is None:
            raise CommandError(f"Отеля «{subdomain}» нет вовсе — стенд не развёрнут")

        problems: list[str] = []
        notes: list[str] = []

        problems.extend(self._check_fleet())

        if options["fleet_only"]:
            return self._finish(problems, notes, subdomain)

        with tenant_context(hotel):
            services = {service.code: service for service in Service.objects.all()}
            tiles = {tile.get("key") for tile in build_showcase(hotel, language="ru")}

            for code, expected in EXPECTED_VENUES.items():
                service = services.get(code)
                if service is None:
                    problems.append(f"{code} ({expected['title']}): сервиса НЕТ в отеле")
                    continue

                if not service.is_active:
                    problems.append(f"{code}: сервис ВЫКЛЮЧЕН")
                if not service.is_guest_facing:
                    problems.append(f"{code}: сервис скрыт от гостя (is_guest_facing=false)")
                if not service.execution_point.is_active:
                    # Заведение при этом видно на витрине, а заказ по нему не
                    # проходит: маршрут ищет ТОЛЬКО активную точку.
                    problems.append(
                        f"{code}: точка исполнения выключена — заказы по заведению не пройдут"
                    )

                categories = Category.objects.filter(service=service, is_active=True).count()
                items = Item.objects.filter(category__service=service).count()
                if categories < expected["categories"]:
                    problems.append(
                        f"{code}: разделов {categories}, ожидалось не меньше {expected['categories']}"
                    )
                if items < expected["items"]:
                    problems.append(
                        f"{code}: позиций {items}, ожидалось не меньше {expected['items']}"
                    )

                if code not in tiles:
                    problems.append(f"{code}: заведения НЕТ на главной витрине гостя")

                self.stdout.write(
                    f"  {code:14} разделов {categories:<3} позиций {items:<4} "
                    f"{'на витрине' if code in tiles else 'НЕ ВИДНО'}"
                )

            for code in sorted(EXPECTED_INTERNAL):
                service = services.get(code)
                if service is None or not service.is_active:
                    problems.append(f"{code}: служебный сервис отсутствует или выключен")

            # Мусор прогонов: сам по себе гостю не виден, но копится по одному
            # за прогон и однажды упрётся в глаза в CMS.
            residue = [
                code
                for code, service in services.items()
                if code not in EXPECTED_VENUES
                and code not in EXPECTED_INTERNAL
                and code != "reception"
            ]
            if residue:
                notes.append(
                    f"остатки прогонов: {len(residue)} сервисов "
                    f"({', '.join(sorted(residue)[:5])}{'…' if len(residue) > 5 else ''})"
                )

        self._finish(problems, notes, subdomain)

    # --- Наполнение трёх отелей ---------------------------------------------

    def _check_fleet(self) -> list[str]:
        """
        Номера, заказы, сессии по каждому отелю стенда — и управление номером
        там, где оно обещано.

        Считаем ЧЕРЕЗ `tenant_context`, а не запросом в базу. Это не
        стилистика: таблицы под RLS, и запрос без выставленного тенанта
        возвращает пустоту, неотличимую от настоящей пропажи. Проверка,
        которая ходит мимо тенанта, однажды сама объявит полный стенд пустым.
        """
        from apps.accounts.models import GuestSession
        from apps.grms.models import (
            ControlElement,
            PublishedConfig,
            RoomPin,
            RoomType,
            RoomTypeRoom,
            Zone,
        )
        from apps.orders.models import Order

        problems: list[str] = []
        for code, expected in FLEET.items():
            hotel = Hotel.all_objects.filter(subdomain=code, deleted_at__isnull=True).first()
            if hotel is None:
                problems.append(f"{code}: отеля НЕТ на стенде")
                continue

            with tenant_context(hotel):
                rooms = Room.objects.count()
                orders = Order.objects.count()
                sessions = GuestSession.objects.count()

                for label, actual, minimum in (
                    ("номеров", rooms, expected["rooms"]),
                    ("заказов", orders, expected["orders"]),
                    ("сессий", sessions, expected["sessions"]),
                ):
                    if actual < minimum:
                        problems.append(
                            f"{code}: {label} {actual}, ожидалось не меньше {minimum}"
                        )

                line = f"  {code:14} номеров {rooms:<4} заказов {orders:<5} сессий {sessions:<5}"

                if expected["room_control"]:
                    types = RoomType.objects.count()
                    published = PublishedConfig.objects.count()
                    bindings = RoomTypeRoom.objects.count()
                    pins = RoomPin.objects.count()
                    zones = Zone.objects.count()
                    elements = ControlElement.objects.count()
                    # Каждое из шести — отдельная строка отказа: «управление
                    # номером сломано» не говорит, что чинить, а «нет
                    # публикации» говорит.
                    for label, actual in (
                        ("тип GRMS", types),
                        ("публикация конфигурации", published),
                        ("привязка комнаты к типу", bindings),
                        ("PIN комнаты", pins),
                        ("зона", zones),
                        ("элемент управления", elements),
                    ):
                        if actual < 1:
                            problems.append(f"{code}: НЕТ ни одной записи «{label}»")
                    line += (
                        f" | GRMS: типов {types} публикаций {published} "
                        f"привязок {bindings} PIN {pins} зон {zones} элементов {elements}"
                    )

                self.stdout.write(line)

        return problems

    def _finish(self, problems: list[str], notes: list[str], subdomain: str) -> None:
        for note in notes:
            self.stdout.write(self.style.WARNING(f"  примечание: {note}"))

        if problems:
            self.stderr.write("")
            for problem in problems:
                self.stderr.write(self.style.ERROR(f"  ✗ {problem}"))
            raise CommandError(
                f"Стенд обеднел: {len(problems)} расхождений. "
                "Починка: manage.py seed_demo_hotel --subdomain "
                f"{subdomain} --force --with-rich-catalog --with-room-control"
                " и manage.py seed_demo_fleet"
            )

        self.stdout.write(
            self.style.SUCCESS(
                f"Стенд цел: {len(FLEET)} отеля наполнены, "
                f"{len(EXPECTED_VENUES)} заведений на витрине, управление номером на месте"
            )
        )
