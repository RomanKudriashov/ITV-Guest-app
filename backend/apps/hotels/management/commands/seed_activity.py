"""
Генератор правдоподобной активности демо-стенда.

Зачем отдельной командой, а не расширением `seed_demo_hotel`: сид отвечает за
СОДЕРЖИМОЕ отеля (меню, номера, персонал) и обязан быть быстрым — его гоняют
при каждом подъёме окружения. Активность это ИСТОРИЯ поверх содержимого, её
объём измеряется сотнями записей, и нужна она только там, где смотрят
аналитику и доски. Смешивать одно с другим значит платить минутами старта за
то, что нужно раз в стенд.

---

ПОМЕТКА. Всё, что создаёт генератор, помечено — иначе демо-данные
неотличимы от настоящих, и следующий, кто придёт разгребать стенд, будет
угадывать. Пометка одна и живёт в `GuestSession.guest_ref`:

    guest_ref = "actgen:v1"

Одного поля достаточно, потому что остальное к сессии привязано ссылками:
заказ знает сессию (и дочерние заказы фан-аута наследуют её от родителя),
отзыв знает заказ, ветка чата знает сессию. То есть правило опознания —
ОДНО и узкое, а не набор эвристик «похоже на демо». Поле выбрано намеренно
служебное: `guest_ref` это ссылка на гостя в PMS, гостю она не показывается
и гостевым API не отдаётся, так что пометка ничего не портит на витрине.

УБОРКА. `--clean` показывает, что нашлось, `--clean --apply` убирает. Без
флага не удаляется ничего: команда, которая удаляет по умолчанию, однажды
удалит не то. После уборки журнал аналитики пересобирается из оставшихся
заказов, поэтому цифры на дашборде сходятся и после отката.

ИДЕМПОТЕНТНОСТЬ. Цель задаётся числом заказов; генератор досоздаёт РАЗНИЦУ
между целью и тем, что уже помечено. Второй прогон с тем же `--orders` не
создаёт ничего, `--orders` больше прежнего — досоздаёт хвост.

ЧЕГО ЗДЕСЬ НЕТ: команд управления номером. Они уходят по живому сокету в
коннектор и исполняются эмулятором сейчас — задним числом их не поставить,
а в журнале они ложатся строками AuditLog, которые пометить нечем, не
трогая продуктовый код ради демо-данных. Управление номером проверяется
руками на экране номера, а не генератором.
"""

from __future__ import annotations

import random
from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.core.context import tenant_context
from apps.core.errors import DomainError
from apps.hotels.models import Hotel

# Метка генератора. Версия в метке — чтобы следующее поколение демо-данных
# можно было отличить от этого, а не убирать всё разом.
ACTIVITY_MARK = "actgen:v1"

# Доля заказов, которая не доходит до конца. Не круглые числа: ровно 10%
# отмен на дашборде выглядят как настройка, а не как жизнь.
CANCELLED_SHARE = 0.11
# Доля «зависших» — приняты и брошены дольше SLA. Ради них на доске есть
# эскалация, и без них её не на чем показать.
STALE_SHARE = 0.06
# Доля завершённых, у которых гость оставил отзыв.
REVIEWED_SHARE = 0.34

# Час начала заказа → вес. Три горба: завтрак, обед и вечер. Ровное
# распределение по суткам дало бы часовой разрез аналитики в виде полки,
# на которой ничего не видно.
HOUR_WEIGHTS = {
    7: 3, 8: 7, 9: 8, 10: 5, 11: 4,
    12: 8, 13: 10, 14: 7, 15: 4, 16: 4,
    17: 5, 18: 8, 19: 11, 20: 10, 21: 7, 22: 4, 23: 2,
    0: 1, 1: 1, 2: 1, 6: 1,
}

COMMENTS = [
    "", "", "", "",  # чаще всего комментария нет
    "Без лука, пожалуйста",
    "Поострее",
    "Аллергия на орехи",
    "Приборы на двоих",
    "Оставьте у двери",
    "Позвоните, когда принесёте",
    "Ребёнок спит, стучать не надо",
    "Побыстрее, если можно",
]

GUEST_LINES = [
    "Здравствуйте! Подскажите, во сколько завтрак?",
    "Можно попросить ещё полотенца?",
    "Спасибо, всё отлично!",
    "А где можно припарковаться?",
    "Заказ уже готовят?",
    "Можно поздний выезд до 14:00?",
    "Работает ли сегодня спа?",
]

STAFF_LINES = [
    "Здравствуйте! Завтрак с 7:00 до 11:00 на первом этаже.",
    "Конечно, горничная поднимется в течение 15 минут.",
    "Рады слышать, хорошего отдыха!",
    "Парковка со стороны главного входа, для гостей бесплатно.",
    "Да, уже на кухне — принесём минут через двадцать.",
    "Поздний выезд подтвердили, до 14:00.",
]

REVIEW_COMMENTS = {
    5: ["Быстро и вкусно", "Всё как заказывали", "Спасибо!", ""],
    4: ["Хорошо, но ждали дольше обещанного", "Вкусно", ""],
    3: ["Нормально", "Принесли не сразу", ""],
    2: ["Долго ждали", "Заказ перепутали"],
    1: ["Так и не дождались", "Очень долго"],
}

AGENTS = [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36",
    "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Safari/537.36",
]

LANGUAGES = ["ru", "ru", "ru", "en", "en", "ar", "zh"]


class Command(BaseCommand):
    help = "Наполнить демо-стенд правдоподобной историей заказов, чатов и отзывов"

    def add_arguments(self, parser):
        parser.add_argument(
            "--subdomain",
            action="append",
            help="Отель. Можно повторить. По умолчанию — все демо-отели",
        )
        parser.add_argument(
            "--orders", type=int, default=300,
            help="Сколько заказов должно быть у отеля ВСЕГО (генератор досоздаёт разницу)",
        )
        parser.add_argument(
            "--days", type=int, default=60,
            help="На сколько суток назад растягивается история",
        )
        parser.add_argument(
            "--seed", type=int, default=20260812,
            help="Зерно генератора: один и тот же прогон даёт одну и ту же историю",
        )
        parser.add_argument(
            "--clean", action="store_true",
            help="Показать, что создано генератором (с --apply — убрать)",
        )
        parser.add_argument(
            "--apply", action="store_true",
            help="Вместе с --clean: действительно убрать",
        )

    def handle(self, *args, **options):
        subdomains = options["subdomain"]
        hotels = Hotel.objects.all().order_by("subdomain")
        if subdomains:
            hotels = hotels.filter(subdomain__in=subdomains)
            missing = set(subdomains) - {h.subdomain for h in hotels}
            if missing:
                raise CommandError(f"Нет отелей: {', '.join(sorted(missing))}")
        if not hotels:
            raise CommandError("Не нашлось ни одного отеля")

        for hotel in hotels:
            if options["clean"]:
                self._clean(hotel, apply=options["apply"])
            else:
                self._generate(
                    hotel,
                    target=options["orders"],
                    days=options["days"],
                    seed=options["seed"],
                )

    # --- Уборка ------------------------------------------------------------

    def _clean(self, hotel: Hotel, *, apply: bool) -> None:
        """
        Убрать за собой ровно по пометке и ничего кроме.

        Порядок важен: заказы удаляются ДО сессий. `Order.guest_session` —
        SET_NULL, и если сначала убрать сессии, заказы останутся сиротами и
        опознать их будет уже нечем.
        """
        from apps.accounts.models import GuestSession
        from apps.analytics.services.recompute import (
            rebuild_raw_from_orders, recompute_aggregates,
        )
        from apps.chat.models import ChatThread
        from apps.orders.models import Order
        from apps.reviews.models import Review

        with tenant_context(hotel):
            sessions = GuestSession.all_objects.filter(guest_ref=ACTIVITY_MARK)
            session_ids = list(sessions.values_list("pk", flat=True))
            orders = Order.all_objects.filter(guest_session_id__in=session_ids)
            order_ids = list(orders.values_list("pk", flat=True))
            threads = ChatThread.all_objects.filter(guest_session_id__in=session_ids)
            reviews = Review.all_objects.filter(order_id__in=order_ids)

            counts = {
                "сессий": len(session_ids),
                "заказов": len(order_ids),
                "веток чата": threads.count(),
                "отзывов": reviews.count(),
            }
            summary = ", ".join(f"{k} {v}" for k, v in counts.items())

            if not apply:
                self.stdout.write(
                    f"{hotel.subdomain}: генератор оставил — {summary}. "
                    "Убрать: добавьте --apply"
                )
                return

            with transaction.atomic():
                # Жёстко, а не мягко: мягко удалённый заказ остаётся в
                # таблице, и следующий прогон посчитал бы его существующим.
                reviews.hard_delete()
                threads.hard_delete()
                orders.hard_delete()
                sessions.hard_delete()

            # Журнал пересобираем из того, что осталось: иначе аналитика
            # продолжила бы показывать убранные заказы.
            rebuild_raw_from_orders(hotel.pk)
            recompute_aggregates(hotel.pk)
            self.stdout.write(self.style.SUCCESS(f"{hotel.subdomain}: убрано — {summary}"))

    # --- Наполнение --------------------------------------------------------

    def _generate(self, hotel: Hotel, *, target: int, days: int, seed: int) -> None:
        from apps.accounts.models import GuestSession
        from apps.analytics.services.recompute import (
            rebuild_raw_from_orders, recompute_aggregates,
        )
        from apps.orders.models import Order

        with tenant_context(hotel):
            existing = Order.objects.filter(
                guest_session__guest_ref=ACTIVITY_MARK, parent__isnull=True
            ).count()
            if existing >= target:
                self.stdout.write(
                    f"{hotel.subdomain}: уже {existing} заказов генератора — цель {target} достигнута"
                )
                return

            plan = self._collect(hotel)
            if plan is None:
                self.stdout.write(
                    self.style.WARNING(
                        f"{hotel.subdomain}: нечего заказывать (пустой каталог или нет номеров) — пропускаю"
                    )
                )
                return

            # Зерно включает поддомен: у трёх отелей должна быть РАЗНАЯ
            # история, иначе на витрине флота видно, что это один шаблон.
            rng = random.Random(f"{seed}:{hotel.subdomain}")
            created = self._make_orders(
                hotel, plan, rng, start_index=existing, count=target - existing, days=days
            )
            chats = self._make_chats(hotel, plan, rng, days=days)

        # Журнал из заказов и пересчёт — тем же редьюсером, что и живьём.
        rebuild_raw_from_orders(hotel.pk)
        recompute_aggregates(hotel.pk)

        with tenant_context(hotel):
            total = Order.objects.filter(guest_session__guest_ref=ACTIVITY_MARK).count()
            sessions = GuestSession.objects.filter(guest_ref=ACTIVITY_MARK).count()
        self.stdout.write(self.style.SUCCESS(
            f"{hotel.subdomain}: +{created['orders']} заказов "
            f"(из них фан-аут {created['fanned']}, отменено {created['cancelled']}, "
            f"зависло {created['stale']}), отзывов {created['reviews']}, "
            f"веток чата {chats}. Всего с пометкой: заказов {total}, сессий {sessions}"
        ))

    def _collect(self, hotel: Hotel):
        """
        Что в этом отеле вообще можно заказать и кем это исполняется.

        Собирается ОДИН раз на отель: три сотни заказов, каждый из которых
        сам ищет себе позицию, — это три сотни лишних выборок.
        """
        from apps.accounts.models import StaffAssignment
        from apps.catalog.models import Item
        from apps.catalog.offerings import OfferingType
        from apps.hotels.models import Room, Service

        rooms = list(Room.objects.all())
        if not rooms:
            return None

        items = list(
            Item.objects.filter(is_active=True)
            .exclude(type=OfferingType.INFO)
            .select_related("category", "category__service")
            .prefetch_related("modifier_groups__options", "request_fields")
        )
        products = [i for i in items if i.type == OfferingType.PRODUCT]
        requests = [i for i in items if i.type == OfferingType.SERVICE_REQUEST]
        slots = [i for i in items if i.type == OfferingType.SLOT]
        if not (products or requests):
            return None

        # Сервис-агрегатор (рум-сервис): его позиции заимствованы у разных
        # заведений, и заказ из них РАЗЪЕЗЖАЕТСЯ фан-аутом. Ради этого пути
        # генератор и нужен — под нагрузкой он иначе не проверен.
        aggregator = (
            Service.objects.filter(inclusions__is_active=True).distinct().first()
        )
        aggregated_products: list = []
        if aggregator is not None:
            aggregated_products = [
                i for i in products
                if i.category and i.category.service_id == aggregator.pk
            ]

        staff_by_point: dict = {}
        for assignment in StaffAssignment.objects.filter(
            is_active=True
        ).select_related("user"):
            staff_by_point.setdefault(assignment.execution_point_id, []).append(assignment.user)

        return {
            "rooms": rooms,
            "products": products,
            "requests": requests,
            "slots": slots,
            "aggregator": aggregator,
            "aggregated": aggregated_products,
            "staff": staff_by_point,
        }

    def _make_orders(self, hotel, plan, rng, *, start_index, count, days) -> dict:
        from apps.orders.models import Order, OrderStatusChange
        from apps.orders.services import OrderInput, OrderLineInput, change_status, create_order
        from apps.orders.services import status_flows
        from apps.reviews.models import Review

        stats = {"orders": 0, "fanned": 0, "cancelled": 0, "stale": 0, "reviews": 0, "skipped": 0}
        now = hotel.local_now()
        hours = list(HOUR_WEIGHTS)
        hour_weights = list(HOUR_WEIGHTS.values())

        for offset in range(count):
            index = start_index + offset
            # Дни ближе к сегодня нагружены сильнее: у живого отеля история
            # не ровная, а с наклоном — и медленные места аналитики видно
            # именно на плотном хвосте.
            days_ago = min(days - 1, int(abs(rng.gauss(0, days / 2.2))))
            hour = rng.choices(hours, weights=hour_weights)[0]
            created = (now - timedelta(days=days_ago)).replace(
                hour=hour, minute=rng.randrange(60), second=rng.randrange(60), microsecond=0
            )
            if created > now:
                created = now - timedelta(minutes=rng.randrange(30, 600))

            room = rng.choice(plan["rooms"])
            session = self._session(hotel, room, created, index, rng)

            kind, lines, service_code = self._pick_lines(plan, rng)
            if not lines:
                stats["skipped"] += 1
                continue

            try:
                with transaction.atomic():
                    order = create_order(
                        OrderInput(
                            lines=lines,
                            service_code=service_code,
                            room_id=str(room.pk),
                            comment=rng.choice(COMMENTS),
                            field_values=self._field_values(lines, plan, rng),
                            delivery_mode=(
                                Order.DeliveryMode.PICKUP if rng.random() < 0.18
                                else Order.DeliveryMode.DELIVERY
                            ),
                        ),
                        guest_session=session,
                    )
            except DomainError as exc:
                # Стоп-лист, минимум заказа, занятый слот — законные отказы.
                # История это украшение стенда, а не условие его работы.
                stats["skipped"] += 1
                if stats["skipped"] <= 5:
                    self.stdout.write(f"  {hotel.subdomain}: заказ пропущен ({exc})")
                continue

            family = [order, *order.children.all()]
            if len(family) > 1:
                stats["fanned"] += 1

            for member in family:
                Order.objects.filter(pk=member.pk).update(created_at=created)
                OrderStatusChange.objects.filter(
                    order_id=member.pk, from_status__isnull=True
                ).update(created_at=created)

            roll = rng.random()
            if roll < CANCELLED_SHARE:
                outcome = "cancelled"
            elif roll < CANCELLED_SHARE + STALE_SHARE:
                outcome = "stale"
            else:
                outcome = "done"

            for member in family:
                self._run_lifecycle(
                    hotel, member, plan, rng, created=created, outcome=outcome,
                    change_status=change_status, status_flows=status_flows,
                    Order=Order, OrderStatusChange=OrderStatusChange,
                )
            if outcome in ("cancelled", "stale"):
                stats[outcome] += 1
            stats["orders"] += 1

            if outcome == "done" and rng.random() < REVIEWED_SHARE:
                rating = rng.choices([5, 4, 3, 2, 1], weights=[52, 24, 12, 8, 4])[0]
                review = Review.objects.create(
                    hotel_id=hotel.pk, order_id=order.pk, guest_session=session,
                    rating=rating, comment=rng.choice(REVIEW_COMMENTS[rating]),
                )
                Review.objects.filter(pk=review.pk).update(
                    created_at=created + timedelta(minutes=rng.randrange(35, 240))
                )
                stats["reviews"] += 1

        if stats["skipped"] > 5:
            self.stdout.write(f"  {hotel.subdomain}: всего пропущено {stats['skipped']}")
        return stats

    def _session(self, hotel, room, created, index, rng):
        """
        Сессия гостя. Часть с подтверждённым номером (PIN), часть — нет.

        `token_hash` детерминирован по индексу: повторный прогон не плодит
        сессии-дубли, а `--clean` находит их по той же пометке, что и всё
        остальное.
        """
        from apps.accounts.models import GuestSession, TrustLevel

        verified = rng.random() < 0.45
        session, _ = GuestSession.objects.get_or_create(
            token_hash=GuestSession.hash_token(f"{ACTIVITY_MARK}:{hotel.subdomain}:{index}"),
            defaults={
                "hotel_id": hotel.pk,
                "room": room,
                "guest_ref": ACTIVITY_MARK,
                "trust": TrustLevel.PMS_VERIFIED if verified else rng.choice(
                    [TrustLevel.ROOM_SCANNED, TrustLevel.ANONYMOUS]
                ),
                "language": rng.choice(LANGUAGES),
                "user_agent": rng.choice(AGENTS),
                "expires_at": GuestSession.default_expiry(),
                "room_verified_at": created if verified else None,
            },
        )
        GuestSession.objects.filter(pk=session.pk).update(
            created_at=created, last_seen_at=created + timedelta(minutes=rng.randrange(5, 90))
        )
        session.refresh_from_db()
        return session

    def _pick_lines(self, plan, rng):
        """Что заказывают: корзина, заявка, бронь слота или агрегат с фан-аутом."""
        from apps.orders.services import OrderLineInput

        roll = rng.random()

        # Агрегат рум-сервиса: несколько позиций от РАЗНЫХ исполнителей, чтобы
        # заказ разъехался. Меньше двух позиций — фан-аута не будет.
        if plan["aggregator"] is not None and len(plan["aggregated"]) >= 2 and roll < 0.22:
            picked = rng.sample(plan["aggregated"], min(len(plan["aggregated"]), rng.randrange(2, 5)))
            return "aggregate", [
                OrderLineInput(
                    item_id=str(item.pk),
                    quantity=rng.choices([1, 2, 3], weights=[70, 22, 8])[0],
                    modifier_option_ids=self._modifiers(item, rng),
                    comment=rng.choice(COMMENTS),
                )
                for item in picked
            ], plan["aggregator"].code

        if plan["slots"] and roll < 0.30:
            item = rng.choice(plan["slots"])
            return "slot", [OrderLineInput(item_id=str(item.pk), quantity=1)], None

        if plan["requests"] and roll < 0.52:
            item = rng.choice(plan["requests"])
            return "request", [OrderLineInput(item_id=str(item.pk), quantity=1)], None

        if not plan["products"]:
            return "none", [], None

        # Корзина: позиции ОДНОЙ категории — иначе заказ без агрегатора
        # законно отклоняется как «разные категории».
        anchor = rng.choice(plan["products"])
        same_category = [i for i in plan["products"] if i.category_id == anchor.category_id]
        picked = rng.sample(same_category, min(len(same_category), rng.choices([1, 2, 3, 4], weights=[45, 30, 17, 8])[0]))
        return "cart", [
            OrderLineInput(
                item_id=str(item.pk),
                quantity=rng.choices([1, 2, 3], weights=[72, 21, 7])[0],
                modifier_option_ids=self._modifiers(item, rng),
                comment=rng.choice(COMMENTS),
            )
            for item in picked
        ], None

    def _modifiers(self, item, rng) -> list[str]:
        """Добавки и опции — их снимок и есть половина смысла строки заказа."""
        chosen: list[str] = []
        for group in item.modifier_groups.all():
            options = list(group.options.all())
            if not options:
                continue
            required = group.is_required or group.min_choices > 0
            # Необязательную группу гость чаще всего не трогает — но не всегда,
            # иначе в снимках строк не будет ни одной добавки.
            if not required and rng.random() > 0.45:
                continue
            low = max(group.min_choices, 1)
            high = min(group.max_choices or 1, len(options))
            if high < low:
                high = low
            count = min(rng.randrange(low, high + 1), len(options))
            chosen += [str(o.pk) for o in rng.sample(options, count)]
        return chosen

    def _field_values(self, lines, plan, rng) -> dict:
        """Ответы на поля заявки: без них service_request не проходит валидацию."""
        from datetime import date as _date

        by_id = {str(i.pk): i for i in plan["requests"] + plan["products"] + plan["slots"]}
        values: dict = {}
        for line in lines:
            item = by_id.get(line.item_id)
            if item is None:
                continue
            for field in item.request_fields.all():
                ftype = field.field_type
                if ftype == "select":
                    options = field.options or []
                    if options:
                        values[field.code] = str(rng.choice(options).get("value"))
                elif ftype in ("number", "count"):
                    low = field.min_value if field.min_value is not None else 1
                    high = field.max_value if field.max_value is not None else low + 3
                    values[field.code] = str(rng.randrange(int(low), int(high) + 1))
                elif ftype == "date":
                    values[field.code] = _date.today().isoformat()
                elif ftype == "time":
                    values[field.code] = f"{rng.randrange(8, 21):02d}:00"
                elif ftype == "bool":
                    values[field.code] = rng.choice(["true", "false"])
                else:
                    values[field.code] = rng.choice(
                        ["Как обычно", "На двоих", "К 19:00", "Спасибо!", "Демо"]
                    )
        return values

    def _run_lifecycle(self, hotel, order, plan, rng, *, created, outcome,
                       change_status, status_flows, Order, OrderStatusChange):
        """
        Полный жизненный цикл заказа задним числом.

        Статусы берём ИЗ ПОТОКА самого заказа: у хозслужбы, спа и консьержа
        свои потоки, и `accepted` там просто нет — код доски ресторана увёл
        бы заказ в чужой поток.
        """
        flow = order.status.flow
        actors = plan["staff"].get(order.execution_point_id) or []
        actor = rng.choice(actors) if actors else None

        if outcome == "cancelled":
            target = status_flows.cancelled_status(flow)
            if target is None:
                return
            at = created + timedelta(minutes=rng.randrange(3, 25))
            change_status(order, to_code=target.code, actor_type="staff",
                          actor_id=actor.pk if actor else None)
            OrderStatusChange.objects.filter(
                order_id=order.pk, to_status__code=target.code
            ).update(created_at=at)
            return

        working = status_flows.first_working_status(flow, order.status.sort_order)
        if working is None:
            return
        accepted_at = created + timedelta(minutes=rng.randrange(1, 12))
        Order.objects.filter(pk=order.pk).update(assignee=actor, accepted_at=accepted_at)
        change_status(order, to_code=working.code, actor_type="staff",
                      actor_id=actor.pk if actor else None)
        OrderStatusChange.objects.filter(
            order_id=order.pk, to_status__code=working.code
        ).update(created_at=accepted_at)

        if outcome == "stale":
            # Принят и брошен: на доске это и есть просрочка до эскалации.
            return

        # Промежуточные статусы потока проходим по одному: «готов», «подан» и
        # прочее у каждого отдела своё, и SLA-аналитика считает именно их.
        elapsed = accepted_at
        for status in status_flows.statuses_for_flow(flow):
            if status.sort_order <= working.sort_order or status.is_cancelled:
                continue
            elapsed += timedelta(minutes=rng.randrange(4, 35))
            fresh = Order.objects.select_related("status").get(pk=order.pk)
            if fresh.status.is_terminal:
                break
            change_status(fresh, to_code=status.code, actor_type="staff",
                          actor_id=actor.pk if actor else None)
            OrderStatusChange.objects.filter(
                order_id=order.pk, to_status__code=status.code
            ).update(created_at=elapsed)

    def _make_chats(self, hotel, plan, rng, *, days) -> int:
        """
        Переписки. Ветка привязана к сессии, поэтому уборка находит их по той
        же пометке, что и заказы, — своего правила опознания не нужно.
        """
        from apps.accounts.models import GuestSession
        from apps.chat.models import ChatMessage, ChatThread
        from apps.chat.services.threads import _default_point

        sessions = list(
            GuestSession.objects.filter(guest_ref=ACTIVITY_MARK).order_by("created_at")
        )
        if not sessions:
            return 0

        point = _default_point()
        if point is None:
            return 0

        # Ветку заводим САМИ, а не через `get_or_create_thread`: тот отдаёт
        # одну ветку на НОМЕР и перепривязывает её к текущей сессии. На чужой
        # ветке это означало бы, что она станет помеченной, и `--clean` убрал
        # бы переписку, которую генератор не создавал.
        taken_rooms = set(
            ChatThread.all_objects.filter(room__isnull=False).values_list("room_id", flat=True)
        )

        # Примерно каждая двенадцатая сессия что-то спрашивает.
        wanted = max(3, len(sessions) // 12)
        picked = rng.sample(sessions, min(wanted, len(sessions)))
        made = 0
        for session in picked:
            if session.room_id in taken_rooms:
                continue
            taken_rooms.add(session.room_id)
            thread = ChatThread.objects.create(
                hotel_id=hotel.pk,
                room_id=session.room_id,
                guest_session=session,
                execution_point=point,
            )
            staff = None
            for users in plan["staff"].values():
                if users:
                    staff = rng.choice(users)
                    break

            at = session.created_at + timedelta(minutes=rng.randrange(5, 120))
            turns = rng.randrange(1, 4)
            for turn in range(turns):
                question = rng.choice(GUEST_LINES)
                answer = rng.choice(STAFF_LINES)
                guest_msg = ChatMessage.objects.create(
                    hotel_id=hotel.pk, thread=thread, author_type=ChatThread.AuthorType.GUEST,
                    author_id=None, author_name="Гость", body=question,
                )
                ChatMessage.objects.filter(pk=guest_msg.pk).update(created_at=at)
                at += timedelta(minutes=rng.randrange(1, 20))
                if staff is not None:
                    staff_msg = ChatMessage.objects.create(
                        hotel_id=hotel.pk, thread=thread,
                        author_type=ChatThread.AuthorType.STAFF,
                        author_id=staff.pk, author_name=staff.full_name or staff.email,
                        body=answer, read_by_guest_at=at,
                    )
                    ChatMessage.objects.filter(pk=staff_msg.pk).update(created_at=at)
                at += timedelta(minutes=rng.randrange(2, 60))

            ChatThread.objects.filter(pk=thread.pk).update(
                created_at=session.created_at, last_message_at=at
            )
            made += 1
        return made
