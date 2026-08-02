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

from django.core.management.base import BaseCommand

from apps.core.context import tenant_context
from apps.hotels.models import Hotel

# `<что-то>-ms<base36>` — ровно то, что генерируют спеки. Якорь на конец строки
# обязателен: без него шаблон поймал бы обычное имя, где такие буквы случайны.
TEST_SUFFIX = re.compile(r"-ms[0-9a-z]{6,}$")
CHAT_BODY = re.compile(r"^(вопрос|ответ|ещё)-ms[0-9a-z]{6,}$")

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

            # Позиции делим по одному признаку: есть ли на них заказ.
            keep, drop = [], []
            for item in items:
                (keep if OrderItem.objects.filter(item=item).exists() else drop).append(item)

            self.stdout.write(
                f"Найдено: позиций {len(items)} (удалить {len(drop)}, выключить {len(keep)} — "
                f"на них есть заказы), разделов {len(categories)}, сообщений чата {len(messages)}, "
                f"брошенных заказов {len(stale)} (открыты дольше {options['stale_hours']} ч)"
            )
            for item in keep:
                self.stdout.write(f"  выключить: {item.code}")
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

            deleted_msgs = ChatMessage.objects.filter(pk__in=[m.pk for m in messages]).delete()

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
                f"Убрано: позиций удалено {deleted_items}, выключено {hidden}; "
                f"разделов удалено {deleted_cats}, выключено {hidden_cats}; "
                f"сообщений удалено {deleted_msgs}; "
                f"брошенных заказов закрыто {closed}"
            )
        )
