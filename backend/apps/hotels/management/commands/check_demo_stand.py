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
            "--skip-health",
            action="store_true",
            help="Не проверять службы, миграции и погоду — только наполнение",
        )
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

        if not options["skip_health"]:
            problems.extend(self._check_health(notes))

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

    # --- Здоровье стенда -------------------------------------------------
    #
    # ВСЕ СЕМЬ ПРОВЕРОК НИЖЕ ВЗЯТЫ ИЗ НАСТОЯЩИХ ПОЛОМОК, каждая один раз уже
    # выстрелила — 18–19.09.2026, на выкатке перед показом. Наполнение тогда
    # было в порядке, команда говорила «стенд цел», а:
    #
    #   * службы расписания не существовало в прод-составе вовсе, и назначенные
    #     задания молча не исполнялись;
    #   * у всех 35 комнат не было категории — правило показа баннера по
    #     категориям работало бы вхолостую;
    #   * на пульте висела точка исполнения от остатка прогонов, и убрать её
    #     удалением заведения было нельзя.
    #
    # «Стенд цел» без этих проверок означало «каталог на месте», а не «стендом
    # можно показывать».

    # Насколько свежим должен быть пульс расписания. Круг у службы 60 с;
    # пять минут — три пропущенных круга подряд, это уже не задержка.
    SCHEDULER_STALE_MINUTES = 5

    def _check_health(self, notes: list[str]) -> list[str]:
        problems: list[str] = []
        problems.extend(self._check_migrations())
        problems.extend(self._check_worker())
        problems.extend(self._check_scheduler())
        problems.extend(self._check_connector(notes))
        problems.extend(self._check_room_categories())
        problems.extend(self._check_weather(notes))
        problems.extend(self._check_orphan_points())
        return problems

    def _check_migrations(self) -> list[str]:
        """
        Непримененная миграция — стенд на половине кода: таблица новая, а
        колонки нет. Снаружи это выглядит как случайная пятисотка в одном
        разделе.
        """
        from django.db import connections
        from django.db.migrations.executor import MigrationExecutor

        executor = MigrationExecutor(connections["default"])
        plan = executor.migration_plan(executor.loader.graph.leaf_nodes())
        if plan:
            # План отдаёт пары (миграция, назад ли) — сами объекты, а не
            # ключи графа. Перепутать легко, и проверка падает ровно там, где
            # должна была сказать правду.
            names = ", ".join(f"{m.app_label}.{m.name}" for m, _ in plan[:5])
            more = "" if len(plan) <= 5 else f" и ещё {len(plan) - 5}"
            return [f"миграции НЕ применены: {len(plan)} — {names}{more}"]
        self.stdout.write("  миграции: применены все")
        return []

    def _check_worker(self) -> list[str]:
        """
        Воркер нужен обработке картинок, экспорту, публикации бренда и командам
        управления номером. Без него они просто не случаются — без ошибки.
        """
        from config.celery import app as celery_app

        try:
            answer = celery_app.control.ping(timeout=3) or []
        except Exception as exc:  # noqa: BLE001 — брокер может быть недоступен
            return [f"воркер: не удалось спросить брокер ({exc})"]
        if not answer:
            return ["воркер НЕ ОТВЕЧАЕТ: задачи копятся в очереди и не исполняются"]
        self.stdout.write(f"  воркер: откликнулись {len(answer)}")
        return []

    def _check_scheduler(self) -> list[str]:
        """
        Пульс, а не «служба запущена»: запущенный процесс, который перестал
        делать круги, выглядит живым и не делает ничего.
        """
        from datetime import timedelta

        from django.utils import timezone

        from apps.core.models import SchedulerHeartbeat

        beat = SchedulerHeartbeat.objects.using("platform").first()
        if beat is None or beat.last_tick_at is None:
            return [
                "служба расписания НЕ ОСТАВИЛА ПУЛЬСА: назначенные задания "
                "(отложенная публикация, отложенные события) не исполняются"
            ]
        age = timezone.now() - beat.last_tick_at
        if age > timedelta(minutes=self.SCHEDULER_STALE_MINUTES):
            return [
                f"пульс расписания протух: последний круг {int(age.total_seconds() // 60)} мин назад"
            ]
        self.stdout.write(
            f"  расписание: круг {int(age.total_seconds())} с назад, "
            f"ждут {beat.pending_count}, просрочено {beat.overdue_count}"
        )
        return []

    def _check_connector(self, notes: list[str]) -> list[str]:
        """
        Коннектор с эмулятором. Узел отмечается сам; «онлайн» — это «отмечался
        недавно», дозвониться до него отсюда мы не можем в принципе.
        """
        from apps.grms.transport import transport
        from apps.hotels.models import HotelModule
        from apps.hotels.module_registry import enabled_module_codes

        hotel = Hotel.all_objects.filter(subdomain="crystal").first()
        if hotel is None:
            return []
        if HotelModule.Code.ROOM_CONTROL not in enabled_module_codes(hotel):
            notes.append("управление номером выключено модулем — коннектор не проверялся")
            return []
        if not transport.node_is_online(hotel):
            return ["коннектор управления номером НЕ НА СВЯЗИ: номер покажет «нет связи»"]
        self.stdout.write("  коннектор управления номером: на связи")
        return []

    def _check_room_categories(self) -> list[str]:
        """
        Категория номера — тарифная («Стандарт», «Делюкс»). По ней работают
        правила показа баннера и разрез аналитики. Пустой справочник не ломает
        ничего заметного — он делает правило бессмысленным.
        """
        from apps.hotels.models import RoomCategory

        problems = []
        for code in FLEET:
            hotel = Hotel.all_objects.filter(subdomain=code).first()
            if hotel is None:
                continue
            with tenant_context(hotel):
                categories = RoomCategory.objects.count()
                rooms = Room.objects.count()
                marked = Room.objects.filter(category__isnull=False).count()
            if categories == 0:
                problems.append(f"{code}: НЕТ ни одной категории номера")
            elif marked == 0 and rooms:
                problems.append(f"{code}: ни один из {rooms} номеров не отнесён к категории")
            else:
                self.stdout.write(
                    f"  {code:14} категорий {categories}, размечено {marked} из {rooms}"
                )
        return problems

    def _check_weather(self, notes: list[str]) -> list[str]:
        """
        Погода — первое, что видит гость на главной. Нет города — блока нет
        вовсе, и это выглядит как «верстка поехала», а не как настройка.
        """
        from apps.integrations.weather import service as weather

        problems = []
        for code in FLEET:
            hotel = Hotel.all_objects.filter(subdomain=code).first()
            if hotel is None:
                continue
            if hotel.latitude is None or hotel.longitude is None:
                problems.append(f"{code}: город не выбран — блока погоды у гостя не будет")
                continue
            with tenant_context(hotel):
                current = weather.current_for(hotel)
            if current is None:
                # Кэш холодный или провайдер молчит: это не поломка стенда, но
                # знать об этом до показа надо.
                notes.append(f"{code}: погода не отдалась (холодный кэш или провайдер молчит)")
            else:
                self.stdout.write(f"  {code:14} погода {current.get('temperature')}°")
        return problems

    def _check_orphan_points(self) -> list[str]:
        """
        Точка исполнения без живого заведения — строка-призрак на пульте
        отеля: заведение удалили, а очередь осталась, и убрать её с экрана
        нечем (пункт 37 бэклога).
        """
        from apps.hotels.models import ExecutionPoint

        problems = []
        for code in FLEET:
            hotel = Hotel.all_objects.filter(subdomain=code).first()
            if hotel is None:
                continue
            with tenant_context(hotel):
                alive = set(Service.objects.values_list("execution_point_id", flat=True))
                orphans = [
                    point.code
                    for point in ExecutionPoint.objects.filter(is_active=True)
                    if point.pk not in alive
                ]
            if orphans:
                problems.append(
                    f"{code}: точки на пульте без живого заведения: {', '.join(sorted(orphans))}"
                )
        return problems

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
