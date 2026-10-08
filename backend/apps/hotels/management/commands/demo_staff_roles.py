"""
Разовая правка демо-персонала для показа прав (партия 48, решение тек-лида 10а).

НЕ СИД. Сид по живому отелю сбрасывает пароли, фото, расписания и создаёт
заказы — здесь меняется ровно четыре вещи и больше ничего:

  1. линейный повар кухни «Кристалла» — `cook@crystal.local`, «Алексей, повар»,
     уровень MEMBER: на кухне сейчас только старший смены и руководители, и
     показать «исполнитель не видит „Назначить“» было не на ком;
  2. имена владельцам трёх демо-отелей — сейчас у них пусто, и в списке
     назначения владелец виден почтой;
  3. снять назначение владельца «Кристалла» с кухни (он назначил себя
     руководителем через CMS 28.08; как администратор он и так видит все доски);
  4. снять назначение выключенной QA-учётки (24.09) на СПА «Кристалла».

По умолчанию — ХОЛОСТОЙ ПРОГОН: печатает список изменений и ничего не пишет.
Запись — только с `--apply`. Идемпотентна: повторный прогон после записи
печатает «изменений нет». Пароль нового повара — тот же, что у всего
демо-персонала (его задаёт сид), и в вывод не попадает.

Назначения снимаются НАСТОЯЩИМ удалением (как в `_replace_assignments`):
уникальность назначения «отель, человек, точка» безусловная, и мягко снятая
строка не дала бы назначить человека снова (класс п.76).

    python manage.py demo_staff_roles            # что изменится
    python manage.py demo_staff_roles --apply    # записать
"""

from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.accounts.models import StaffAssignment, User
from apps.core.context import tenant_context
from apps.hotels.models import ExecutionPoint, Hotel

# Тот же пароль, что сид ставит всему демо-персоналу (`seed_demo_hotel`).
_DEMO_PASSWORD = "chef12345"

COOK_EMAIL = "cook@crystal.local"
COOK_NAME = "Алексей, повар"
OWNER_NAMES = {
    "crystal": "Владелец «Кристалла»",
    "azure": "Владелец «Азура»",
    "lumen": "Владелец «Люмена»",
}
QA_EMAIL_PREFIX = "qa-e2e-"


class Command(BaseCommand):
    help = "Демо-персонал для показа прав: повар на кухне Кристалла, имена владельцам, снять лишние назначения."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Записать (без флага — холостой прогон)")

    def handle(self, *args, apply: bool = False, **options):
        changes: list[str] = []
        with transaction.atomic():
            for subdomain, name in OWNER_NAMES.items():
                hotel = Hotel.objects.filter(subdomain=subdomain, is_active=True).first()
                if hotel is None:
                    changes.append(f"[{subdomain}] отеля нет — пропуск")
                    continue
                with tenant_context(hotel):
                    self._owner_name(hotel, name, apply, changes)
                    if subdomain == "crystal":
                        self._crystal(hotel, apply, changes)
            if not apply:
                transaction.set_rollback(True)

        real = [line for line in changes if "пропуск" not in line]
        mode = "ЗАПИСАНО" if apply else "ХОЛОСТОЙ ПРОГОН — ничего не записано"
        self.stdout.write(f"== demo_staff_roles: {mode}")
        if not real:
            self.stdout.write("изменений нет")
        for line in changes:
            self.stdout.write(f"  {line}")

    # --- шаги -------------------------------------------------------------------

    def _owner_name(self, hotel, name: str, apply: bool, changes: list[str]) -> None:
        owner = User.objects.filter(email=f"owner@{hotel.subdomain}.local").first()
        if owner is None:
            changes.append(f"[{hotel.subdomain}] владельца owner@{hotel.subdomain}.local нет — пропуск")
            return
        if (owner.full_name or "").strip():
            return
        changes.append(f"[{hotel.subdomain}] имя владельцу {owner.email}: «{name}»")
        if apply:
            User.objects.filter(pk=owner.pk).update(full_name=name)

    def _crystal(self, hotel, apply: bool, changes: list[str]) -> None:
        kitchen = ExecutionPoint.objects.filter(code="kitchen", is_active=True).first()
        spa = ExecutionPoint.objects.filter(code="spa").first()

        # 1. Линейный повар кухни.
        if kitchen is None:
            changes.append("[crystal] точки kitchen нет — повара не завести, пропуск")
        else:
            cook = User.objects.filter(email=COOK_EMAIL).first()
            if cook is None:
                changes.append(f"[crystal] новый сотрудник {COOK_EMAIL} «{COOK_NAME}» (пароль — как у демо-персонала)")
                if apply:
                    cook = User.objects.create_user(
                        email=COOK_EMAIL,
                        password=_DEMO_PASSWORD,
                        hotel=hotel,
                        full_name=COOK_NAME,
                        language="ru",
                        is_staff_member=True,
                    )
            has_assignment = cook is not None and StaffAssignment.objects.filter(
                user=cook, execution_point=kitchen
            ).exists()
            if not has_assignment:
                changes.append(f"[crystal] назначение {COOK_EMAIL} → kitchen, уровень member")
                if apply:
                    StaffAssignment.objects.create(
                        hotel_id=hotel.pk, user=cook, execution_point=kitchen,
                        level=StaffAssignment.Level.MEMBER,
                    )

        # 3. Владелец — не на кухне.
        owner = User.objects.filter(email="owner@crystal.local").first()
        if owner is not None and kitchen is not None:
            self._drop(owner, kitchen, "владелец — администратор, видит все доски без назначения", apply, changes)

        # 4. Выключенная QA-учётка — не на СПА.
        if spa is not None:
            for qa in User.objects.filter(email__startswith=QA_EMAIL_PREFIX, is_active=False):
                self._drop(qa, spa, "учётка выключена", apply, changes)

    def _drop(self, user, point, why: str, apply: bool, changes: list[str]) -> None:
        rows = StaffAssignment.all_objects.filter(user=user, execution_point=point)
        if not rows.exists():
            return
        changes.append(f"[crystal] снять назначение {user.email} → {point.code} ({why})")
        if apply:
            rows.hard_delete()
            from apps.realtime.sessions import revoke_point_access

            revoke_point_access(user.pk, [point.pk])
