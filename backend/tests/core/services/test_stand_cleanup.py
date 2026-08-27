"""
Уборка стенда: брошенные заказы.

Каждый прогон E2E оставляет заказы в рабочих статусах — их никто не доводит до
конца. На доске это выглядит как отказ системы («2515 мин» красным на каждой
карточке), а счётчики колонок растут от прогона к прогону.

Здесь закреплено ровно то, что можно и чего нельзя делать с такими заказами.
Граница проходит не по «тестовости» (у заказа нет кода, за который зацепиться),
а по двум признакам: заказ незавершён И его время прошло.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.core.management import call_command
from django.utils import timezone

from apps.core.context import tenant_context
from apps.orders.models import Order, StatusDefinition

# Платформенная база — потому что команда убирает не только остатки отеля, но и
# учётки, которые прогоны консоли заводят на уровне платформы. Без объявления
# pytest-django запрещает запрос и все одиннадцать тестов падают одинаково.
pytestmark = pytest.mark.django_db(databases=["default", "platform"])


def _make_order(hotel, *, age_hours: float, status_code: str, requested_time=None) -> Order:
    """Заказ заданного возраста. `created_at` — auto_now_add, поэтому проставляем после."""
    from apps.hotels.models import ExecutionPoint, Room

    with tenant_context(hotel):
        status = StatusDefinition.objects.filter(flow="board", code=status_code).first()
        assert status is not None, f"нет статуса {status_code}"
        order = Order.objects.create(
            number=Order.objects.count() + 9000,
            room=Room.objects.first(),
            execution_point=ExecutionPoint.objects.first(),
            status=status,
            total=1000,
            requested_time=requested_time,
        )
        Order.objects.filter(pk=order.pk).update(
            created_at=timezone.now() - timedelta(hours=age_hours)
        )
        return Order.objects.get(pk=order.pk)


def test_stale_open_order_is_closed_not_deleted(crystal):
    """Брошенный заказ уходит с доски, но остаётся в истории целиком."""
    order = _make_order(crystal, age_hours=48, status_code="new")
    with tenant_context(crystal):
        before = Order.objects.count()

    call_command("clean_test_residue", "--subdomain", "crystal", "--apply", verbosity=0)

    with tenant_context(crystal):
        refreshed = Order.objects.get(pk=order.pk)
        assert refreshed.status.is_terminal, "заказ обязан уйти с активной доски"
        assert refreshed.status.code == "cancelled"
        # Главное: ни одна строка не пропала. Заказ — это выручка и чек.
        assert Order.objects.count() == before


def test_fresh_open_order_is_left_alone(crystal):
    """Живой заказ трогать нельзя — им занимаются прямо сейчас."""
    order = _make_order(crystal, age_hours=1, status_code="new")

    call_command("clean_test_residue", "--subdomain", "crystal", "--apply", verbosity=0)

    with tenant_context(crystal):
        assert not Order.objects.get(pk=order.pk).status.is_terminal


def test_future_booking_survives_however_old(crystal):
    """
    Бронь на БУДУЩЕЕ брошенной не является, даже если оформлена давно.

    Спа-слот на следующую неделю заводят заранее: его `created_at` стар по
    определению, и правило «старше суток — закрыть» уничтожило бы настоящую
    запись гостя. Признак не возраст заказа, а прошло ли назначенное время.
    """
    order = _make_order(
        crystal,
        age_hours=72,
        status_code="new",
        requested_time=timezone.now() + timedelta(days=5),
    )

    call_command("clean_test_residue", "--subdomain", "crystal", "--apply", verbosity=0)

    with tenant_context(crystal):
        assert not Order.objects.get(pk=order.pk).status.is_terminal, (
            "будущая бронь не должна закрываться по возрасту"
        )


def test_dry_run_changes_nothing(crystal):
    """Без `--apply` команда обязана только рассказывать."""
    order = _make_order(crystal, age_hours=48, status_code="new")

    call_command("clean_test_residue", "--subdomain", "crystal", verbosity=0)

    with tenant_context(crystal):
        assert not Order.objects.get(pk=order.pk).status.is_terminal


# --- Заведения прогонов ------------------------------------------------------


def _residue_service(hotel, code: str):
    """Заведение с суффиксом, который генерирует спека, — как на живом стенде."""
    from apps.hotels.models import ExecutionPoint, Service

    with tenant_context(hotel):
        point = ExecutionPoint.objects.create(
            code=code, title={"ru": "Прогон"}, kind=ExecutionPoint.Kind.OTHER
        )
        return Service.objects.create(
            code=code, execution_point=point, public_name={"ru": "Прогон"}
        )


def test_residue_service_without_orders_is_deleted_with_its_point(crystal):
    """
    Заведение прогона уходит вместе со своей точкой исполнения.

    Точка без сервиса — осиротевший исполнитель, которого не видно ни в одном
    списке; так же её уносит и удаление из CMS.
    """
    from apps.hotels.models import ExecutionPoint, Service

    service = _residue_service(crystal, "rum-servis-msabcdef")
    point_id = service.execution_point_id

    call_command("clean_test_residue", subdomain=crystal.subdomain, apply=True)

    with tenant_context(crystal):
        assert not Service.objects.filter(pk=service.pk).exists()
        assert not ExecutionPoint.objects.filter(pk=point_id).exists()


def test_residue_service_with_orders_is_switched_off_not_deleted(crystal):
    """
    С заказами — только выключить.

    Ровно та же причина, по которой отказывает CMS (`409 service_has_orders`):
    заказы держат точку через PROTECT, и удаление осиротило бы историю выручки.
    """
    from apps.hotels.models import Service

    service = _residue_service(crystal, "rum-servis-msfedcba")
    order = _make_order(crystal, age_hours=1, status_code="new")
    with tenant_context(crystal):
        Order.objects.filter(pk=order.pk).update(execution_point=service.execution_point_id)

    call_command("clean_test_residue", subdomain=crystal.subdomain, apply=True)

    with tenant_context(crystal):
        alive = Service.objects.filter(pk=service.pk).first()
        assert alive is not None, "заведение с заказами удалять нельзя"
        assert alive.is_active is False, "но выключить обязано"


def test_real_services_are_never_touched(crystal):
    """
    Признак — суффикс прогона, а не «похожесть имени».

    Настоящие заведения демо-стенда называются `kitchen`, `spa`, `concierge`;
    ни одно из них под правило попасть не должно, иначе уборка съест стенд.
    """
    from apps.hotels.models import Service

    with tenant_context(crystal):
        before = {s.code: s.is_active for s in Service.objects.all() if "-ms" not in (s.code or "")}
    assert before, "на стенде нет ни одного настоящего заведения — проверять нечего"

    call_command("clean_test_residue", subdomain=crystal.subdomain, apply=True)

    with tenant_context(crystal):
        after = {s.code: s.is_active for s in Service.objects.all() if "-ms" not in (s.code or "")}
    assert after == before


def test_dry_run_leaves_services_alone(crystal):
    from apps.hotels.models import Service

    service = _residue_service(crystal, "rum-servis-msdryrun")

    call_command("clean_test_residue", subdomain=crystal.subdomain)

    with tenant_context(crystal):
        alive = Service.objects.filter(pk=service.pk).first()
    assert alive is not None and alive.is_active is True


# --- Режим стенда: удалять остатки вместе с их заказами ----------------------


def test_residue_with_orders_is_purged_only_with_the_flag(crystal):
    """
    Без флага — выключить, с флагом — удалить целиком.

    Флаг снимает ровно одно ограничение и только на стенде: там заказ не
    история и не выручка, а след прогона. По умолчанию поведение прежнее,
    иначе команда однажды съела бы выручку боевого отеля.
    """
    from apps.hotels.models import ExecutionPoint, Service

    service = _residue_service(crystal, "rum-servis-mspurge1")
    order = _make_order(crystal, age_hours=1, status_code="new")
    with tenant_context(crystal):
        Order.objects.filter(pk=order.pk).update(execution_point=service.execution_point_id)

    # Прежний режим: заведение живо и выключено, заказ на месте.
    call_command("clean_test_residue", subdomain=crystal.subdomain, apply=True)
    with tenant_context(crystal):
        alive = Service.objects.filter(pk=service.pk).first()
        assert alive is not None and alive.is_active is False
        assert Order.all_objects.filter(pk=order.pk).exists(), "без флага заказ трогать нельзя"

    # Режим стенда: уходит всё — заведение, его точка и заказ.
    call_command(
        "clean_test_residue", subdomain=crystal.subdomain, apply=True, purge_orders=True
    )
    with tenant_context(crystal):
        assert not Service.all_objects.filter(pk=service.pk).exists()
        assert not ExecutionPoint.all_objects.filter(pk=service.execution_point_id).exists()
        assert not Order.all_objects.filter(pk=order.pk).exists()


def test_purge_takes_the_fan_out_children_too(crystal):
    """
    Дочерний заказ исполняется НАСТОЯЩЕЙ точкой, но заведён тем же прогоном.

    Оставить его нельзя технически: `Order.parent` стоит на CASCADE. Тест
    закрепляет это как обещание, а не как побочный эффект.
    """
    from apps.hotels.models import Service

    service = _residue_service(crystal, "rum-servis-msfanout")
    parent = _make_order(crystal, age_hours=1, status_code="new")
    child = _make_order(crystal, age_hours=1, status_code="new")
    with tenant_context(crystal):
        Order.objects.filter(pk=parent.pk).update(execution_point=service.execution_point_id)
        # Ребёнок остаётся на СВОЕЙ, настоящей точке — как на живом стенде.
        Order.objects.filter(pk=child.pk).update(parent=parent.pk)

    call_command(
        "clean_test_residue", subdomain=crystal.subdomain, apply=True, purge_orders=True
    )

    with tenant_context(crystal):
        assert not Order.all_objects.filter(pk=parent.pk).exists()
        assert not Order.all_objects.filter(pk=child.pk).exists(), "фан-аут обязан уйти с родителем"


def test_real_service_with_orders_survives_even_in_purge_mode(crystal):
    """
    Флаг не расширяет ПРИЗНАК, а только меняет судьбу найденного.

    Настоящее заведение не подходит под суффикс прогона ни в одном режиме —
    иначе флаг стал бы кнопкой «стереть отель».
    """
    from apps.hotels.models import Service

    with tenant_context(crystal):
        real = Service.objects.exclude(code__contains="-ms").first()
        assert real is not None
        orders_before = Order.all_objects.filter(
            execution_point=real.execution_point_id
        ).count()

    call_command(
        "clean_test_residue", subdomain=crystal.subdomain, apply=True, purge_orders=True
    )

    with tenant_context(crystal):
        still = Service.objects.filter(pk=real.pk).first()
        assert still is not None and still.is_active is True
        assert (
            Order.all_objects.filter(execution_point=real.execution_point_id).count()
            == orders_before
        )
