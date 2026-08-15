"""
Стенд масштаба: много отелей и длинный журнал.

ЗАЧЕМ. Консоль писалась и проверялась на трёх отелях и коротком журнале, и на
таком объёме не видно ни N+1, ни выборок без предела: пятьдесят шесть запросов
на страницу выглядят так же, как шесть. Чтобы «стало лучше» перестало быть
ощущением, нужны числа ДО — а для чисел нужен объём.

ПОМЕЧАЕТ СВОИ ЗАПИСИ. Отели получают `origin=test` и признак в settings,
записи журнала — маркер в payload. Это не косметика: без метки уборка
угадывала бы по именам и однажды снесла настоящий отель с похожим кодом.

УБИРАЕТ ЗА СОБОЙ. `--drop` удаляет ровно помеченное, жёстко: мягкое удаление
двухсот отелей оставило бы двести занятых поддоменов.

    python manage.py seed_scale --hotels 200 --audit 50000
    python manage.py seed_scale --drop
"""

from __future__ import annotations

import random
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.core.context import platform_scope
from apps.core.models import AuditLog
from apps.hotels.models import Hotel

MARK_KEY = "scale_seed"
SUBDOMAIN_PREFIX = "scale-"
BATCH = 1000

# Действия берём НАСТОЯЩИЕ: журнал фильтруется по действию, и выдуманные коды
# сделали бы проверку фильтра проверкой ни о чём.
ACTIONS = [
    "platform.login",
    "platform.hotel.created",
    "platform.hotel.entered",
    "platform.hotel.modules_changed",
    "platform.hotel.tariff_changed",
    "platform.team.invited",
    "platform.2fa.enabled",
    "impersonation.started",
]


class Command(BaseCommand):
    help = "Насеять отели и журнал для замеров масштаба (или убрать насеянное)"

    def add_arguments(self, parser):
        parser.add_argument("--hotels", type=int, default=200)
        parser.add_argument("--audit", type=int, default=50_000)
        parser.add_argument("--days", type=int, default=90, help="За сколько дней размазать журнал")
        parser.add_argument("--drop", action="store_true", help="Убрать всё насеянное")

    def handle(self, *args, **options):
        if options["drop"]:
            return self._drop()
        self._seed(options["hotels"], options["audit"], options["days"])

    # --- Посев --------------------------------------------------------------

    def _seed(self, hotels_count: int, audit_count: int, days: int) -> None:
        with platform_scope():
            existing = list(
                Hotel.all_objects.using("platform")
                .filter(subdomain__startswith=SUBDOMAIN_PREFIX)
                .values_list("subdomain", flat=True)
            )
            have = set(existing)
            fresh: list[Hotel] = []
            for index in range(1, hotels_count + 1):
                subdomain = f"{SUBDOMAIN_PREFIX}{index:04d}"
                if subdomain in have:
                    continue
                fresh.append(
                    Hotel(
                        subdomain=subdomain,
                        name={"ru": f"Нагрузочный отель {index:04d}", "en": f"Scale hotel {index:04d}"},
                        origin=Hotel.Origin.TEST,
                        is_active=index % 7 != 0,  # часть выключена — фильтры должны это видеть
                        settings={MARK_KEY: True},
                        tariff=random.choice(["start", "standard", "business"]),
                    )
                )
            if fresh:
                # По одному отелю на строку, но одним запросом: двести
                # provision_hotel() создавали бы сервисы и персонал, а для
                # замеров списка нужны сами строки.
                Hotel.all_objects.using("platform").bulk_create(fresh, batch_size=BATCH)
            self.stdout.write(f"отелей: было {len(have)}, добавлено {len(fresh)}")

            ids = list(
                Hotel.all_objects.using("platform")
                .filter(subdomain__startswith=SUBDOMAIN_PREFIX)
                .values_list("id", flat=True)
            )
            have_audit = (
                AuditLog.all_objects.using("platform")
                .filter(payload__has_key=MARK_KEY)
                .count()
            )
            need = max(0, audit_count - have_audit)
            now = timezone.now()
            made = 0
            while made < need:
                chunk = min(BATCH, need - made)
                rows = []
                for _ in range(chunk):
                    # Разброс по времени — иначе курсорное листание и фильтр по
                    # дате проверялись бы на записях одной секунды.
                    at = now - timedelta(
                        days=random.randint(0, days),
                        seconds=random.randint(0, 86_399),
                    )
                    hotel_id = random.choice(ids) if random.random() < 0.7 else None
                    rows.append(
                        AuditLog(
                            hotel_id=hotel_id,
                            actor_type=AuditLog.ActorType.PLATFORM,
                            action=random.choice(ACTIONS),
                            object_type="platform",
                            payload={MARK_KEY: True, "n": made},
                            created_at=at,
                        )
                    )
                with transaction.atomic(using="platform"):
                    AuditLog.all_objects.using("platform").bulk_create(rows, batch_size=BATCH)
                    # `auto_now_add` перетирает дату при вставке — возвращаем
                    # разброс отдельным UPDATE, иначе весь журнал ляжет «сейчас».
                    for row in rows:
                        AuditLog.all_objects.using("platform").filter(pk=row.pk).update(
                            created_at=row.created_at
                        )
                made += chunk
                self.stdout.write(f"  журнал: {made}/{need}", ending="\r")
            self.stdout.write(f"\nжурнал: было {have_audit}, добавлено {made}")

    # --- Уборка -------------------------------------------------------------

    def _drop(self) -> None:
        with platform_scope():
            gone_audit = (
                AuditLog.all_objects.using("platform")
                .filter(payload__has_key=MARK_KEY)
                .hard_delete()
            )
            gone_hotels = (
                Hotel.all_objects.using("platform")
                .filter(subdomain__startswith=SUBDOMAIN_PREFIX)
                .hard_delete()
            )
        self.stdout.write(
            self.style.SUCCESS(
                f"Убрано: записей журнала {gone_audit[0]}, отелей {gone_hotels[0]}"
            )
        )
