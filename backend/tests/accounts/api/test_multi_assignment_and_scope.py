"""
ПРАВА, КОТОРЫЕ РАНЬШЕ НИЧЕМ НЕ ДЕРЖАЛИСЬ.

Три дыры, найденные разведкой, и один механизм, который работал верно, но не
был закреплён ни одной проверкой:

  * журнал уведомлений не резался вовсе — управляющий видел отправки всего
    отеля;
  * администратор отеля не открывал НИ ОДНОЙ доски: назначения у него нет, а
    трекер спрашивал именно назначение;
  * человек с двумя назначениями разных уровней — единственное место, где
    права складываются, а не выстраиваются лестницей.

Сравнения здесь идут ПО СОСТАВУ, а не по количеству: «управляющий видит
меньше» верно и у сломанной резки, которая просто отдала первую страницу.
Проверяем, что записи РАЗНЫЕ и что чужих среди них нет.
"""

from __future__ import annotations

import pytest

from apps.accounts.models import StaffAssignment, User
from apps.core.context import tenant_context
from apps.hotels.models import ExecutionPoint
from apps.notifications.models import NotificationLog

pytestmark = pytest.mark.django_db


def _point(hotel, code: str) -> ExecutionPoint:
    with tenant_context(hotel):
        return ExecutionPoint.objects.get(code=code)


@pytest.fixture
def dual_user(crystal):
    """Управляющий кухней и одновременно линейный в спа — как в жизни."""
    with tenant_context(crystal):
        user = User.objects.create_user(
            "dual@crystal.local", "chef12345", hotel=crystal, full_name="Двойное назначение"
        )
        StaffAssignment.objects.create(
            hotel=crystal,
            user=user,
            execution_point=ExecutionPoint.objects.get(code="kitchen"),
            level=StaffAssignment.Level.MANAGER,
        )
        StaffAssignment.objects.create(
            hotel=crystal,
            user=user,
            execution_point=ExecutionPoint.objects.get(code="spa"),
            level=StaffAssignment.Level.MEMBER,
        )
        return user


# --- Журнал уведомлений ----------------------------------------------------


def _order_at(hotel, point_code: str):
    """Заказ на конкретной точке — журнал режется именно по ней."""
    from apps.catalog.models import Item
    from apps.orders.models import Order
    from apps.orders.services import OrderInput, OrderLineInput, create_order

    item = Item.objects.get(code="caesar")
    order = create_order(OrderInput(lines=[OrderLineInput(item_id=str(item.pk))]))
    Order.objects.filter(pk=order.pk).update(
        execution_point=ExecutionPoint.objects.get(code=point_code)
    )
    order.refresh_from_db()
    return order


def _log_for(hotel, order, key: str) -> NotificationLog:
    return NotificationLog.objects.create(
        hotel=hotel, order=order, dedupe_key=key, target_kind="point"
    )


def test_the_notification_log_is_cut_by_the_order_point(crystal):
    """
    Журнал режется по точке ЗАКАЗА.

    Признак выбран так, чтобы он был у каждой записи: связь с заказом
    обязательна в модели, тогда как правило бывает общеотельным, а у
    родительской записи «ступень сработала» канала нет вовсе.

    ДАННЫЕ ЗАВОДЯТСЯ ЗДЕСЬ ЖЕ. Первая версия опиралась на журнал стенда — в
    тестовой базе он пуст, и проверка падала на пустых данных вместо того,
    чтобы проверять правило.
    """
    from apps.core.context import set_actor
    from apps.notifications.services.cms import list_logs

    with tenant_context(crystal):
        kitchen_order = _order_at(crystal, "kitchen")
        bar_order = _order_at(crystal, "bar")
        mine = _log_for(crystal, kitchen_order, "test-kitchen")
        foreign = _log_for(crystal, bar_order, "test-bar")

        manager = User.objects.get(email="manager.restaurant@crystal.local")
        owner = User.objects.get(email="owner@crystal.local")

        set_actor(owner)
        everything = {row["id"] for row in list_logs(limit=500)["items"]}
        set_actor(manager)
        visible = {row["id"] for row in list_logs(limit=500)["items"]}

        assert str(mine.pk) in everything and str(foreign.pk) in everything, (
            "владелец обязан видеть обе отправки"
        )
        assert str(mine.pk) in visible, "управляющий потерял отправку своей точки"
        assert str(foreign.pk) not in visible, (
            "управляющий кухней видит отправку бара — журнал не режется"
        )
        assert visible < everything, "у владельца обязано остаться то, чего нет у управляющего"

        set_actor(None)


# --- Доски администратора --------------------------------------------------


def test_hotel_admin_opens_every_board_without_a_single_assignment(crystal):
    """
    У администратора отеля назначений нет и быть не должно — он не стоит на
    смене ни в одном заведении. Раньше это стоило ему всех досок разом.
    """
    from apps.orders.services.tracker import assigned_points, require_point

    with tenant_context(crystal):
        owner = User.objects.get(email="owner@crystal.local")
        assert not StaffAssignment.objects.filter(user=owner).exists(), (
            "проверка потеряла смысл: администратору завели назначение"
        )

        points = assigned_points(owner)
        total = ExecutionPoint.objects.filter(is_active=True).count()
        assert len(points) == total, "администратор обязан видеть ВСЕ доски отеля"

        # И каждая из них открывается, а не только показывается в списке.
        for code in ("kitchen", "bar", "spa"):
            assert require_point(owner, code).code == code


def test_line_staff_still_sees_only_his_own_point(crystal):
    """Раздав доски администратору, нельзя раздать их всем."""
    from apps.core.errors import PermissionDenied
    from apps.orders.services.tracker import assigned_points, require_point

    with tenant_context(crystal):
        barman = User.objects.get(email="barman@crystal.local")
        assert [point.code for point in assigned_points(barman)] == ["bar"]
        assert require_point(barman, "bar").code == "bar"
        with pytest.raises(PermissionDenied):
            require_point(barman, "kitchen")


# --- Несколько назначений --------------------------------------------------


def test_two_assignments_add_up_instead_of_ranking(crystal, dual_user):
    """
    Управляющий кухней + линейный в спа.

    Права — СУММА: доска по обоим назначениям, CMS — только по тому, где он
    управляющий. Лестницы уровней здесь нет: линейный в спа не делает его
    линейным везде, а управляющий кухней не делает управляющим спа.
    """
    from apps.accounts.services.roles import access_for
    from apps.orders.services.tracker import assigned_points, require_point

    with tenant_context(crystal):
        access = access_for(dual_user)
        kitchen = str(ExecutionPoint.objects.get(code="kitchen").pk)
        spa = str(ExecutionPoint.objects.get(code="spa").pk)

        assert access.managed_point_ids == frozenset({kitchen})
        assert access.member_point_ids == frozenset({kitchen, spa})
        assert access.has_cms_access is True
        assert access.payload()["role"] == "service_manager"

        # Доска — по ОБОИМ назначениям.
        assert sorted(point.code for point in assigned_points(dual_user)) == ["kitchen", "spa"]
        assert require_point(dual_user, "kitchen").code == "kitchen"
        assert require_point(dual_user, "spa").code == "spa"

        # А CMS — только по управляемой точке.
        assert access.manages_point(kitchen) is True
        assert access.manages_point(spa) is False


def test_demoting_the_manager_takes_the_cms_but_leaves_the_second_board(crystal, dual_user):
    """
    Понизили до линейного в кухне — CMS исчезла в тот же момент, а доска спа
    осталась: она держалась на ДРУГОМ назначении и к понижению отношения не
    имеет.
    """
    from apps.accounts.services.roles import access_for
    from apps.orders.services.tracker import assigned_points

    with tenant_context(crystal):
        StaffAssignment.objects.filter(
            user=dual_user, execution_point__code="kitchen"
        ).update(level=StaffAssignment.Level.MEMBER)

        access = access_for(dual_user)
        assert access.managed_point_ids == frozenset()
        assert access.has_cms_access is False, "управляющих точек не осталось — CMS закрыта"
        assert access.payload()["role"] == "line_staff"

        assert sorted(point.code for point in assigned_points(dual_user)) == ["kitchen", "spa"], (
            "понижение уровня не отбирает доски — человек по-прежнему на смене"
        )


# --- Уровень отеля закрыт от управляющего ----------------------------------


HOTEL_LEVEL_READS = [
    "/api/cms/rooms",
    "/api/cms/rooms/qr-sheet",
    "/api/cms/locations",
    "/api/cms/locations/matrix",
    "/api/cms/brand",
    "/api/cms/brand/presets",
    "/api/cms/brand/fonts",
    "/api/cms/brand/abstractions",
    "/api/cms/grms/types",
    "/api/cms/grms/access",
    "/api/cms/grms/diagnostics",
    "/api/cms/review-settings",
]


@pytest.mark.parametrize("path", HOTEL_LEVEL_READS)
def test_hotel_level_reads_are_closed_for_a_service_manager(cms_manager, cms, path):
    """
    ЧТЕНИЕ УРОВНЯ ОТЕЛЯ — АДМИНСКОЕ, как и запись рядом.

    Правка этих объектов давно требовала администратора, а списки отдавались
    любому управляющему: фонд номеров, география отеля, тема оформления и
    журнал обмена с оборудованием читались руководителем одного ресторана.
    Экранов этих он не видит — пункты меню помечены `hotel_admin_only`, — то
    есть ручка отдавала то, за чем по интерфейсу прийти нельзя.

    Админ при этом обязан читать всё: иначе мы не дыру закрыли, а сломали
    работу.
    """
    """
    Проверяем ПРИЧИНУ отказа, а не только код.

    GRMS закрыт ещё и платным модулем, и в демо-отеле он выключен: там 403
    приходит и администратору — но по другой причине. Сравнение «управляющему
    403» без разбора причины зеленело бы и на выключенном модуле, то есть
    молчало бы о снятой проверке роли.
    """
    admin_response = cms.get(path)
    assert admin_response.status_code in (200, 403)
    if admin_response.status_code == 403:
        assert admin_response.json()["code"] == "module_disabled", (
            "администратор потерял доступ к своему разделу"
        )

    refused = cms_manager.get(path)
    assert refused.status_code == 403
    assert refused.json()["code"] == "hotel_admin_only", (
        "отказ пришёл не от роли — проверка уровня отеля не работает"
    )


def test_reviews_are_cut_by_the_order_point(cms_manager, cms, crystal):
    """
    Отзыв — об одной заявке (`Review.order`, связь один к одному), а заявка
    принадлежит заведению. Раздел не имел ни одной проверки прав.

    Сравниваем СОСТАВ, а не количество: «меньше» верно и у сломанной резки,
    которая просто отдала первую страницу.
    """
    from apps.reviews.models import Review

    with tenant_context(crystal):
        kitchen_order = _order_at(crystal, "kitchen")
        bar_order = _order_at(crystal, "bar")
        mine = Review.objects.create(hotel=crystal, order=kitchen_order, rating=5)
        foreign = Review.objects.create(hotel=crystal, order=bar_order, rating=4)

    everything = {row["id"] for row in cms.get("/api/cms/reviews?limit=500").json()}
    visible = {row["id"] for row in cms_manager.get("/api/cms/reviews?limit=500").json()}

    assert str(mine.pk) in everything and str(foreign.pk) in everything
    assert str(mine.pk) in visible, "управляющий потерял отзыв о своей заявке"
    assert str(foreign.pk) not in visible, "управляющий кухней видит отзыв бара"
    assert visible < everything


def test_schedules_stay_readable_but_only_the_admin_writes_them(cms_manager, cms):
    """
    РЕШЕНИЕ, А НЕ НЕДОДЕЛКА. Резать расписания по заведениям нечем: у модели
    нет ни точки, ни сервиса, а одно расписание законно делится между
    заведениями. Поэтому читать их может каждый, кто допущен в CMS — выбрать
    готовое расписание для своей позиции обычная работа управляющего, — а
    заводить общий на отель справочник может только администратор.
    """
    assert cms_manager.get("/api/cms/schedules").status_code == 200
    assert cms.get("/api/cms/schedules").status_code == 200

    refused = cms_manager.post("/api/cms/schedules", {"name": "Смена управляющего"})
    assert refused.status_code == 403
    assert refused.json()["code"] == "hotel_admin_only"
