"""
Уборка остатков автотестов в отеле.

Зачем команда, а не разовый запрос в шелле: такие остатки есть на каждом стенде,
где гонялись тесты до появления teardown (R6), и разработчику нужен
воспроизводимый инструмент, а не рецепт в переписке.

ПРАВИЛО ОПОЗНАНИЯ — узкое и названное явно. Убираем только то, что подходит под
шаблон имени, который порождают сами тесты: `<slug>-ms<base36>` — суффикс это
`Date.now().toString(36)` из спеков. Никакой эвристики «похоже на тестовое»:
угадывание нельзя ни доверить удалению, ни объяснить тому, чей раздел по ошибке
сочли мусором. Поэтому по умолчанию команда НИЧЕГО не удаляет и лишь печатает
список — удаление включается флагом.

ЧТО НЕ УДАЛЯЕТСЯ НИКОГДА: позиция, на которую ссылается строка заказа. Такая
позиция — часть истории: удалив её, мы порвём чек, который отель уже отдал
гостю. Её выключают, и она перестаёт быть видимой гостю, оставаясь в истории.

ЗАВИСШИЕ ЗАКАЗЫ. Каждый прогон E2E оставляет заказы в рабочих статусах: их
никто не доводит до конца, и они копятся. На доске это выглядит как отказ
системы — «2515 мин» красным на каждой карточке, — а счётчики колонок растут от
прогона к прогону. Такие заказы НЕ УДАЛЯЮТСЯ: заказ это история и выручка.
Они переводятся в терминальный «отменён» своего потока — с доски уходят,
в истории и аналитике остаются целиком.

Порог намеренно крупный (STALE_HOURS): заказ, открытый дольше суток, — это уже
не «в работе», а брошенный. Живой заказ, которым занимаются прямо сейчас, под
правило не попадает, и это главное, что здесь нельзя сломать.
"""

from __future__ import annotations

import re

from django.core.cache import cache
from django.core.management.base import BaseCommand

from apps.core.context import tenant_context
from apps.hotels.models import Hotel, Room

# `<что-то>-ms<base36>` — ровно то, что генерируют спеки. Якорь на конец строки
# обязателен: без него шаблон поймал бы обычное имя, где такие буквы случайны.
TEST_SUFFIX = re.compile(r"-ms[0-9a-z]{6,}$")
CHAT_BODY = re.compile(r"^(вопрос|ответ|ещё)-ms[0-9a-z]{6,}$")

# Типы номеров, которые заводит прогон раздела GRMS в CMS: он импортирует
# настоящий файл ПНР, и на стенде остаются ТИП1/ТИП2/ТИП3. Опознаём ПАРОЙ
# признаков — код из файла И разметка, которую кладёт только тест. У живого
# отеля тип с тем же именем есть, но зоны и элементы у него свои, и под
# правило он не попадёт.
GRMS_IMPORTED_CODES = {"tip1", "tip2", "tip3"}
GRMS_TEST_MARKS = {"e2e-zone", "e2e.light"}

# ОСТАТКИ В КОМАНДЕ ПЛАТФОРМЫ. Прогоны консоли заводят наблюдателей и поддержку
# и не убирают их за собой: `eyes-<Date.now()>@platform.test`,
# `support-<Date.now()>@platform.test` (см. e2e/tests/console-actions.spec.ts).
#
# Копится это молча и однажды ЛОМАЕТ САМИ ПРОГОНЫ: выдача команды ограничена
# сотней, и настоящие учётки вытесняются с неё мусором. Проверка «в списке есть
# platform@itv.local» падает так, будто сломалась консоль, — а сломались данные.
#
# Шаблон узкий и с якорями: только эти два префикса, только цифры времени,
# только домен `.test` (он зарезервирован под тесты и настоящим быть не может).
PLATFORM_TEST_EMAIL = re.compile(r"^(?:eyes|support)-\d{10,}@platform\.test$")

# Через сколько часов открытый заказ считается брошенным. Сутки с запасом:
# смена длится меньше, и ни один живой заказ столько в работе не висит.
STALE_HOURS = 24


class Command(BaseCommand):
    help = "Показать (и по флагу убрать) остатки автотестов в отеле"

    def add_arguments(self, parser):
        parser.add_argument("--subdomain", default="crystal")
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Действительно убрать. Без флага — только показать, что нашлось",
        )
        parser.add_argument(
            "--purge-orders",
            action="store_true",
            help=(
                "ТОЛЬКО ДЛЯ СТЕНДА. Удалить заведения-остатки ВМЕСТЕ с их тестовыми "
                "заказами, а не выключать. Уносит и фан-аут: заказ прогона разложен "
                "по настоящим точкам, и дочерние заказы уйдут вместе с родителем "
                "(Order.parent — CASCADE). На боевом отеле не запускать: заказ это "
                "история и выручка"
            ),
        )
        parser.add_argument(
            "--stale-hours",
            type=int,
            default=STALE_HOURS,
            help=f"С какого возраста открытый заказ считать брошенным (по умолчанию {STALE_HOURS})",
        )

    def handle(self, *args, **options):
        from datetime import timedelta

        from django.utils import timezone

        from apps.catalog.models import Category, Item
        from apps.chat.models import ChatMessage
        from apps.grms.models import ControlElement, RoomType, Zone  # noqa: F401
        from apps.analytics.models import AnalyticsEvent
        from apps.hotels.models import ExecutionPoint, Service
        from apps.orders.models import Order, OrderItem, StatusDefinition

        hotel = Hotel.objects.filter(subdomain=options["subdomain"]).first()
        if hotel is None:
            self.stderr.write(f"Отель «{options['subdomain']}» не найден")
            return

        apply = options["apply"]
        with tenant_context(hotel):
            items = [item for item in Item.objects.all() if TEST_SUFFIX.search(item.code)]
            categories = [c for c in Category.objects.all() if TEST_SUFFIX.search(c.code)]
            messages = [m for m in ChatMessage.objects.all() if CHAT_BODY.match((m.body or "").strip())]

            # Заведения прогонов. Тем же признаком, что позиции и разделы, —
            # суффиксом, который генерирует спека, а не «похожестью имени».
            # Без этого они копились каждым прогоном: за время работы стенда
            # их набралось 58 при семи настоящих.
            services = [s for s in Service.objects.all() if TEST_SUFFIX.search(s.code or "")]

            # Заказы, брошенные прогонами: открыты дольше порога. Опознаём по
            # возрасту и незавершённости, а не по имени — у заказа нет кода, за
            # который можно зацепиться, и придумывать его ради уборки нельзя.
            now = timezone.now()
            cutoff = now - timedelta(hours=options["stale_hours"])
            stale = [
                order
                for order in Order.objects.select_related("status").filter(created_at__lt=cutoff)
                if not order.status.is_terminal
                # Бронь на БУДУЩЕЕ брошенной не является, даже если оформлена
                # давно: спа-слот на следующую неделю заводят заранее, и его
                # `created_at` стар по определению. Возраст заказа тут не
                # признак — признак в том, прошло ли назначенное время.
                and not (order.requested_time and order.requested_time > now)
            ]

            # Типы номеров из прогона раздела GRMS. Тип уносит с собой всё
            # своё: переменные, зоны, элементы, привязки и опубликованные
            # версии — на них ссылается только он сам.
            grms_types = []
            for room_type in RoomType.objects.filter(code__in=GRMS_IMPORTED_CODES):
                marks = set(
                    Zone.objects.filter(room_type=room_type).values_list("code", flat=True)
                ) | set(
                    ControlElement.objects.filter(room_type=room_type).values_list(
                        "slug", flat=True
                    )
                )
                # Пустой тип — тоже след прогона: импорт заводит переменные, а
                # интерфейс к ним собирает уже человек.
                if not marks or marks & GRMS_TEST_MARKS:
                    grms_types.append(room_type)

            # Позиции делим по одному признаку: есть ли на них заказ.
            keep, drop = [], []
            for item in items:
                (keep if OrderItem.objects.filter(item=item).exists() else drop).append(item)

            # Заведения — по тому же признаку и той же причиной, по которой
            # отказывает CMS (`409 service_has_orders`): заказы ссылаются на
            # точку исполнения через PROTECT, и удаление осиротило бы историю
            # выручки. Такое заведение выключается, а не удаляется.
            #
            # `--purge-orders` снимает именно ЭТО ограничение, и только на
            # стенде: там заказ не история и не выручка, а след прогона.
            purge = options["purge_orders"]
            keep_services, drop_services = [], []
            for service in services:
                busy_service = Order.all_objects.filter(
                    execution_point=service.execution_point_id
                ).exists()
                (drop_services if purge or not busy_service else keep_services).append(service)

            # Заказы остатков и их фан-аут. Дочерний заказ исполняется НАСТОЯЩЕЙ
            # точкой (кухня, бар), но заведён тем же прогоном и уйдёт с
            # родителем в любом случае: Order.parent стоит на CASCADE.
            purge_orders: list = []
            if purge and drop_services:
                parent_ids = list(
                    Order.all_objects.filter(
                        execution_point__in=[s.execution_point_id for s in drop_services]
                    ).values_list("id", flat=True)
                )
                child_ids = list(
                    Order.all_objects.filter(parent__in=parent_ids).values_list("id", flat=True)
                )
                purge_orders = parent_ids + child_ids

            self.stdout.write(
                f"Найдено: позиций {len(items)} (удалить {len(drop)}, выключить {len(keep)} — "
                f"на них есть заказы), разделов {len(categories)}, сообщений чата {len(messages)}, "
                f"брошенных заказов {len(stale)} (открыты дольше {options['stale_hours']} ч), "
                f"типов номеров из прогона GRMS {len(grms_types)}, "
                f"заведений {len(services)} (удалить {len(drop_services)}, "
                f"выключить {len(keep_services)} — на них есть заказы)"
            )
            if purge:
                self.stdout.write(
                    self.style.WARNING(
                        f"  РЕЖИМ СТЕНДА: заказов будет удалено {len(purge_orders)} "
                        f"(вместе с фан-аутом по настоящим точкам)"
                    )
                )
            for service in keep_services:
                self.stdout.write(f"  выключить заведение: {service.code}")
            for room_type in grms_types:
                self.stdout.write(f"  удалить тип: {room_type.code}")
            for item in keep:
                self.stdout.write(f"  выключить: {item.code}")
        # --- Остатки в команде платформы -----------------------------------
        #
        # ВНЕ тенанта: у платформенного пользователя `hotel = NULL`, и роль
        # приложения таких строк НЕ ВИДИТ — запрос вернул бы ноль строк и не
        # упал. Поэтому идём платформенным подключением, как и всё остальное
        # платформенного уровня.
        from apps.accounts.models import User
        from apps.core.context import platform_scope

        # ЖИВЫЕ, а не «все как есть». Удаление в проекте мягкое, и без этого
        # фильтра команда находила уже удалённых и бодро сообщала, что убрала
        # их снова: отчёт о работе, которой не было. Такой отчёт хуже
        # отсутствующего — по нему делают вывод, что стенд чист.
        stale_platform = [
            user
            for user in User.all_objects.using("platform").filter(
                hotel__isnull=True,
                email__endswith="@platform.test",
                deleted_at__isnull=True,
            )
            if PLATFORM_TEST_EMAIL.match(user.email or "")
        ]
        for user in stale_platform:
            self.stdout.write(f"  учётка платформы: {user.email}")
        dropped_platform = 0
        if apply and stale_platform:
            # В platform_scope: вне его платформенное подключение работает под
            # политиками изоляции, и запись без отеля для него не существует.
            with platform_scope():
                for user in stale_platform:
                    user.delete(using="platform")
                    dropped_platform += 1

            if not apply:
                self.stdout.write(self.style.WARNING("Пробный проход. Повторите с --apply."))
                return

            hidden = Item.objects.filter(pk__in=[i.pk for i in keep]).update(
                is_active=False, in_stock=False
            )
            # Удаление в проекте МЯГКОЕ (`deleted_at`), и оно здесь уместно:
            # это не офбординг по закону, а уборка стенда — строка должна
            # перестать попадаться, но незачем терять её след.
            deleted_items = Item.objects.filter(pk__in=[i.pk for i in drop]).delete()

            # Раздел удаляем, только если в нём не осталось ни одной позиции:
            # иначе он держит выключенные и обязан остаться вместе с ними.
            empty = [c for c in categories if not Item.objects.filter(category=c).exists()]
            busy = [c for c in categories if c not in empty]
            deleted_cats = Category.objects.filter(pk__in=[c.pk for c in empty]).delete()
            hidden_cats = Category.objects.filter(pk__in=[c.pk for c in busy]).update(is_active=False)

            # Заказы — ДО заведений: точка защищена от них PROTECT. Жёстко, а не
            # мягко: мягкое оставило бы строки, ради которых всё и затевалось.
            # Событие аналитики ссылается на заказ полем без FK, каскад его не
            # унесёт — убираем явно, иначе журнал будет считать удалённое.
            purged_orders = 0
            if purge_orders:
                AnalyticsEvent.objects.filter(order_id__in=purge_orders).hard_delete()
                purged_orders = Order.all_objects.filter(
                    pk__in=purge_orders
                ).hard_delete()[1].get("orders.Order", 0)

            # Заведение уносит с собой свою точку исполнения: связь 1:1, и
            # точка без сервиса — это осиротевший исполнитель, которого не
            # видно ни в одном списке. Так же делает и удаление из CMS.
            point_ids = [s.execution_point_id for s in drop_services if s.execution_point_id]
            # В обычном режиме удаление МЯГКОЕ, как и всё в проекте: это уборка
            # стенда, а не офбординг, и след строки терять незачем. В режиме
            # `--purge-orders` — жёстко: заказы этого заведения уже удалены
            # физически, и оставлять от него мягкую строку значит держать на
            # стенде заведение без своей истории, которое всё равно попадётся
            # следующей выборке.
            service_ids = [s.pk for s in drop_services]
            if purge:
                deleted_services = Service.all_objects.filter(pk__in=service_ids).hard_delete()
                ExecutionPoint.all_objects.filter(pk__in=point_ids).hard_delete()
            else:
                deleted_services = Service.objects.filter(pk__in=service_ids).delete()
                ExecutionPoint.objects.filter(pk__in=point_ids).delete()
            hidden_services = Service.objects.filter(
                pk__in=[s.pk for s in keep_services]
            ).update(is_active=False)

            deleted_msgs = ChatMessage.objects.filter(pk__in=[m.pk for m in messages]).delete()
            # ЖЁСТКО, а не мягко. Мягкое удаление оставляет строку с тем же
            # кодом, и следующий импорт того же файла падает на уникальности
            # `(отель, код)`: тип «уже есть», хотя его не видно. Проверено
            # прогоном — импорт перестал заводить ТИП3 ровно после того, как
            # уборка научилась убирать типы.
            deleted_types = 0
            for room_type in grms_types:
                _drop_room_type(room_type)
                deleted_types += 1

            # СЧЁТЧИКИ НЕУДАЧНЫХ PIN — тоже след прогона, и вредный.
            #
            # Тест на неверный код бьёт по комнате 305 каждым прогоном, а
            # счётчик комнаты живёт сутки и общий для всех устройств: пятнадцать
            # прогонов подряд — и комната заблокирована на пятнадцать минут.
            # Дальше падает не тот тест, который «испортил», а следующий, и
            # выглядит это как дефект продукта.
            #
            # Чистим здесь, а не уводим тест в отдельную комнату: у 305 есть и
            # PIN, и план, и привязка к типу — ровно то, что показывают людям и
            # что должен проверять прогон. Отдельная комната потребовала бы
            # своей мебели на стенде, которую тоже пришлось бы за собой убирать.
            cleared_pins = 0
            for room in Room.objects.all():
                if cache.get(f"grms:pin:room:{room.pk}") is not None:
                    cache.delete(f"grms:pin:room:{room.pk}")
                    cleared_pins += 1

            # Заказ НЕ удаляем: это история и выручка. Переводим в терминальный
            # «отменён» СВОЕГО потока — статусы у потоков разные, и один общий
            # код здесь поставил бы заказу чужой статус.
            cancelled_by_flow: dict[str, StatusDefinition] = {}
            closed = 0
            for order in stale:
                flow = order.status.flow
                terminal = cancelled_by_flow.get(flow)
                if terminal is None:
                    terminal = StatusDefinition.objects.filter(
                        flow=flow, code="cancelled"
                    ).first()
                    if terminal is None:
                        self.stderr.write(f"У потока «{flow}» нет статуса отмены — пропускаю")
                        continue
                    cancelled_by_flow[flow] = terminal
                order.status = terminal
                order.save(update_fields=["status", "updated_at"])
                closed += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Учёток платформы убрано {dropped_platform}; "
                f"позиций удалено {deleted_items}, выключено {hidden}; "
                f"разделов удалено {deleted_cats}, выключено {hidden_cats}; "
                f"заведений удалено {deleted_services}, выключено {hidden_services}; "
                + (f"заказов удалено {purged_orders}; " if purge else "")
                + 
                f"сообщений удалено {deleted_msgs}; "
                f"типов номеров удалено {deleted_types}; "
                f"счётчиков PIN сброшено {cleared_pins}; "
                f"брошенных заказов закрыто {closed}"
            )
        )


def _drop_room_type(room_type) -> None:
    """
    Убрать тип номера со всем, что на нём висит.

    Порядок продиктован ссылками: переменная защищена привязкой (`PROTECT`),
    поэтому сначала уходят привязки, потом элементы и зоны, потом переменные,
    снимки версий и связи с комнатами — и только затем сам тип.
    """
    from apps.grms.models import (
        Binding,
        ControlElement,
        PublishedConfig,
        RoomTypeRoom,
        Variable,
        Zone,
    )

    for model, lookup in (
        (Binding, {"element__room_type": room_type}),
        (ControlElement, {"room_type": room_type}),
        (Zone, {"room_type": room_type}),
        (Variable, {"room_type": room_type}),
        (PublishedConfig, {"room_type": room_type}),
        (RoomTypeRoom, {"room_type": room_type}),
    ):
        for row in model.all_objects.filter(**lookup):
            row.delete(hard=True)
    room_type.delete(hard=True)
