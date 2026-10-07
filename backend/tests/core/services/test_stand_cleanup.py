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
        assert alive.is_guest_facing is False, "и спрятать от гостя (партия 41)"


def _run(hotel, *, apply: bool) -> str:
    from io import StringIO

    out = StringIO()
    call_command("clean_test_residue", subdomain=hotel.subdomain, apply=apply, stdout=out)
    return out.getvalue()


def test_already_hidden_residue_is_not_work_again(crystal):
    """
    Второй проход не рапортует о работе, которой нет (партия 41).

    Заведение с заказами остаётся в таблице навсегда. Раньше каждый проход
    находил его заново и писал «выключить 195» — при том, что всё давно
    выключено: по такому отчёту нельзя понять, чисто ли.
    """
    service = _residue_service(crystal, "rum-servis-mtagain1")
    order = _make_order(crystal, age_hours=1, status_code="new")
    with tenant_context(crystal):
        Order.objects.filter(pk=order.pk).update(execution_point=service.execution_point_id)

    first = _run(crystal, apply=True)
    assert "заведений удалено 0, выключено 1" in first, first

    second = _run(crystal, apply=False)
    assert "rum-servis-mtagain1" not in second, second
    assert "заведений 0 " in second, second


def test_forgotten_cocktail_category_with_ordered_item_is_hidden_with_it(crystal):
    """
    «Коктейли <метка>» прогонов: позиция с заказом выключается, раздел — тоже,
    и на втором проходе это уже не работа (партия 41).
    """
    from apps.catalog.models import Category, Item
    from apps.orders.models import OrderItem

    with tenant_context(crystal):
        category = Category.objects.create(code="kokteyli-mtcockt1", title={"ru": "Коктейли"}, type="product")
        item = Item.objects.create(
            category=category, code="shprits-mtcockt1", title={"ru": "Шприц"}, type="product", price=100
        )
    order = _make_order(crystal, age_hours=1, status_code="new")
    with tenant_context(crystal):
        OrderItem.objects.create(order=order, item=item, title_snapshot={"ru": "Шприц"})

    _run(crystal, apply=True)

    with tenant_context(crystal):
        item.refresh_from_db()
        category.refresh_from_db()
        assert item.is_active is False and item.in_stock is False
        assert category.is_active is False

    second = _run(crystal, apply=False)
    assert "позиций 0 " in second and "разделов 0," in second, second


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


# --- Сессии прогонов: страховка к выходу -----------------------------------


def _session(hotel, *, agent: str, age_hours: float):
    from apps.accounts.models import StaffSession, User
    from apps.core.context import platform_scope

    with platform_scope():
        user = User.all_objects.using("platform").get(email="owner@crystal.local")
        session = StaffSession(
            hotel_id=hotel.pk,
            user=user,
            scope="staff",
            user_agent=agent,
            expires_at=timezone.now() + timedelta(days=7),
        )
        session.save(using="platform")
        StaffSession.all_objects.using("platform").filter(pk=session.pk).update(
            created_at=timezone.now() - timedelta(hours=age_hours)
        )
        return session.pk


def _revoked(pk) -> bool:
    from apps.accounts.models import StaffSession
    from apps.core.context import platform_scope

    with platform_scope():
        return StaffSession.all_objects.using("platform").get(pk=pk).revoked_at is not None


def test_stale_e2e_sessions_are_closed_as_a_safety_net(crystal):
    """
    Прогон выходит сам; уборка подбирает то, что выход пропустил, — только по
    явной метке в строке браузера и только старше порога.
    """
    marked = _session(crystal, agent="Mozilla/5.0 … Chrome/149 Safari/537.36 ITV-E2E", age_hours=48)
    api = _session(crystal, agent="Playwright/1.61.1 (arm64; macOS 15.6) node/23.11", age_hours=48)
    fresh = _session(crystal, agent="Playwright/1.61.1", age_hours=0)
    human = _session(crystal, agent="Mozilla/5.0 … Chrome/149 Safari/537.36", age_hours=48)

    call_command("clean_test_residue", "--subdomain", "crystal", verbosity=0)
    assert not _revoked(marked), "пробный проход ничего не закрывает"

    call_command("clean_test_residue", "--subdomain", "crystal", "--apply", verbosity=0)
    assert _revoked(marked)
    assert _revoked(api)
    assert not _revoked(fresh), "свежий вход может быть идущим прогоном"
    assert not _revoked(human), "без метки строка неотличима от настоящего браузера"


# --- Расписания «Закрыто сейчас» (партия 30, п.56) ---------------------------


def test_closed_now_schedules_left_by_runs_are_removed_and_real_ones_kept(crystal):
    """
    Остаток прогона — расписание `Закрыто сейчас <13 цифр>`, ни к чему не
    привязанное и не свежее. Привязанное, свежее и настоящее остаются.
    """
    from datetime import time

    from apps.hotels.models import Schedule, ScheduleInterval, Service

    stamp = "1759500000000"
    with tenant_context(crystal):
        residue = Schedule.objects.create(name=f"Закрыто сейчас {stamp}")
        fresh = Schedule.objects.create(name="Закрыто сейчас 1759500000001")
        in_use = Schedule.objects.create(name="Закрыто сейчас 1759500000002")
        real = Schedule.objects.create(name="Закрыто сейчас на ремонт")
        Schedule.objects.filter(pk__in=[residue.pk, in_use.pk, real.pk]).update(
            created_at=timezone.now() - timedelta(hours=1)
        )
        Service.objects.filter(code="kitchen").update(schedule=in_use)
        # Как у прогона: часы у расписания есть. Свои интервалы — не «ссылка».
        for schedule in (residue, fresh, in_use, real):
            ScheduleInterval.objects.create(
                schedule=schedule, weekday=0, start_time=time(3, 0), end_time=time(4, 0)
            )

    call_command("clean_test_residue", "--subdomain", "crystal", verbosity=0)
    with tenant_context(crystal):
        assert Schedule.objects.filter(pk=residue.pk).exists(), "пробный проход ничего не трогает"

    call_command("clean_test_residue", "--subdomain", "crystal", "--apply", verbosity=0)
    with tenant_context(crystal):
        left = set(Schedule.all_objects.filter(pk__in=[residue.pk, fresh.pk, in_use.pk, real.pk]).values_list("pk", flat=True))
    assert left == {fresh.pk, in_use.pk, real.pk}


def test_review_chat_residue_is_removed_and_real_chat_kept(crystal):
    """Сообщение разбора отзыва из прогона уходит; похожее живое — остаётся."""
    from apps.chat.models import ChatMessage, ChatThread
    from apps.hotels.models import Room

    with tenant_context(crystal):
        thread = ChatThread.objects.create(room=Room.objects.first(), last_message_at=timezone.now())
        residue = ChatMessage.objects.create(thread=thread, author_type="guest", body="где мой заказ mutsc0v3")
        real = ChatMessage.objects.create(thread=thread, author_type="guest", body="где мой заказ? жду час")

    call_command("clean_test_residue", "--subdomain", "crystal", "--apply", verbosity=0)
    with tenant_context(crystal):
        alive = set(ChatMessage.objects.filter(pk__in=[residue.pk, real.pk]).values_list("pk", flat=True))
    assert alive == {real.pk}


# --- Жёстко и только локально (партия 41, п.70) -------------------------------

LOCAL = dict(DEBUG=True, APP_DOMAINS=[], GUEST_APP_BASE_DOMAINS=["guest.localhost", "naviapp.localhost"])


@pytest.mark.parametrize(
    "stand",
    [
        dict(LOCAL, DEBUG=False),
        dict(LOCAL, APP_DOMAINS=["naviapp.navicentric.ru"]),
        dict(LOCAL, GUEST_APP_BASE_DOMAINS=["app.147.45.245.172.sslip.io"]),
    ],
    ids=["debug-off", "app-domains", "public-base"],
)
def test_hard_local_refuses_anywhere_but_local(crystal, stand):
    """
    Признак стенда — любой из трёх — и команда отказывается, ничего не тронув.
    Заказ это история и выручка; локальность доказывается всеми признаками сразу.
    """
    from django.core.management.base import CommandError
    from django.test import override_settings

    from apps.hotels.models import Service

    service = _residue_service(crystal, "rum-servis-mtstand1")
    order = _make_order(crystal, age_hours=1, status_code="new")
    with tenant_context(crystal):
        Order.objects.filter(pk=order.pk).update(execution_point=service.execution_point_id)

    with override_settings(**stand), pytest.raises(CommandError, match="только для локальной базы"):
        call_command("clean_test_residue", subdomain=crystal.subdomain, apply=True, hard_local=True)

    with tenant_context(crystal):
        assert Service.all_objects.filter(pk=service.pk).exists()
        assert Order.all_objects.filter(pk=order.pk).exists()


def test_hard_local_removes_residue_with_its_orders(crystal):
    """
    Локально остатки уходят ФИЗИЧЕСКИ: заведение прогона с заказами, раздел
    коктейлей с заказанной позицией, мягко удалённая позиция прошлой уборки.
    Настоящие заведения и чужие заказы — на месте.
    """
    from django.test import override_settings

    from apps.catalog.models import Category, Item
    from apps.hotels.models import ExecutionPoint, Service
    from apps.orders.models import OrderItem

    service = _residue_service(crystal, "rum-servis-mthard01")
    aggregated = _make_order(crystal, age_hours=1, status_code="new")
    bar_order = _make_order(crystal, age_hours=1, status_code="new")
    real_order = _make_order(crystal, age_hours=1, status_code="new")
    with tenant_context(crystal):
        Order.objects.filter(pk=aggregated.pk).update(execution_point=service.execution_point_id)
        category = Category.objects.create(code="kokteyli-mthard01", title={"ru": "Коктейли"}, type="product")
        item = Item.objects.create(category=category, code="shprits-mthard01", title={"ru": "Шприц"}, type="product", price=100)
        ghost = Item.objects.create(category=category, code="negroni-mthard01", title={"ru": "Негрони"}, type="product", price=100)
        OrderItem.objects.create(order=bar_order, item=item, title_snapshot={"ru": "Шприц"})
        ghost.delete()  # мягко — как оставляла прежняя уборка
        real = {s.code for s in Service.objects.all() if "-m" not in s.code}

    with override_settings(**LOCAL):
        call_command("clean_test_residue", subdomain=crystal.subdomain, apply=True, hard_local=True)

    with tenant_context(crystal):
        assert not Service.all_objects.filter(pk=service.pk).exists()
        assert not ExecutionPoint.all_objects.filter(pk=service.execution_point_id).exists()
        assert not Category.all_objects.filter(pk=category.pk).exists()
        assert not Item.all_objects.filter(pk__in=[item.pk, ghost.pk]).exists()
        assert not Order.all_objects.filter(pk__in=[aggregated.pk, bar_order.pk]).exists()
        assert Order.all_objects.filter(pk=real_order.pk).exists(), "чужой заказ не трогаем"
        assert real <= {s.code for s in Service.objects.all()}, "настоящие заведения на месте"


def test_apply_refuses_a_hotel_outside_the_demo_fleet():
    """
    Живой отель — только пробный проход (партия 41). Шаблон метки прогона
    совпадает со словами: у Сиалии на стенде под него подошли `spa-manicure` и
    `shop-tea-matsesta`, и `--apply` по ней удалил бы настоящий маникюр.
    """
    from django.core.management.base import CommandError
    from django.test import override_settings

    with pytest.raises(CommandError, match="не демо-отель"):
        call_command("clean_test_residue", subdomain="sialia", apply=True)
    # И локально, где жёсткий режим разрешён, — живой отель всё равно мимо.
    with override_settings(**LOCAL), pytest.raises(CommandError, match="не демо-отель"):
        call_command("clean_test_residue", subdomain="sialia", apply=True, hard_local=True)


def test_dry_run_on_any_hotel_is_allowed():
    """Посмотреть можно где угодно: пробный проход ничего не меняет."""
    from io import StringIO

    out = StringIO()
    call_command("clean_test_residue", subdomain="sialia", stderr=out, stdout=out)
    assert "не найден" in out.getvalue()
