"""
ВОЗВРАТ ЗАКАЗА В РАБОТУ: что можно, что нельзя и что при этом запоминается.

До этой партии терминальный статус был стеной: нажали «Доставлено» не на той
карточке — и назад нельзя ничем, кроме правки в базе. Стена убрана, но не вся:
отмена остаётся односторонней, потому что она уже освободила слот и отпустила
гостя.

Каждая проверка сравнивает с ОЖИДАЕМЫМ значением, а не с «не пусто»: момент
закрытия, который просто «есть», ничего не доказывает — он мог остаться с
прошлого закрытия, и ровно так дефект и живёт незамеченным.
"""

from __future__ import annotations

from datetime import timedelta

from django.utils import timezone

import pytest

from apps.accounts.models import User
from apps.catalog.models import Item
from apps.core.context import tenant_context
from apps.orders.models import Order, OrderStatusChange
from apps.orders.services import OrderInput, OrderLineInput, create_order
from apps.orders.services import status_flows
from apps.orders.services.services import change_status
from apps.orders.services.closing import closing_moment
from apps.orders.services.tracker import next_statuses, serialize_tracker_order
from apps.core.errors import ConflictError

pytestmark = pytest.mark.django_db


def _order() -> Order:
    item = Item.objects.get(code="caesar")
    return create_order(OrderInput(lines=[OrderLineInput(item_id=str(item.pk))]))


def _terminal(order: Order, *, cancelled: bool):
    return next(
        status
        for status in status_flows.statuses_for_flow(order.status.flow)
        if status.is_terminal and status.is_cancelled is cancelled
    )


def _working(order: Order):
    """Первый рабочий статус после начального — «принят» у доски."""
    return next(
        status
        for status in status_flows.statuses_for_flow(order.status.flow)
        if not status.is_terminal and not status.is_initial
    )


def test_closing_stamps_the_moment_and_reopening_wipes_it(crystal):
    with tenant_context(crystal):
        order = _order()
        done = _terminal(order, cancelled=False)
        work = _working(order)

        change_status(order, to_code=done.code, actor_type="staff")
        order.refresh_from_db()
        closed_first = order.closed_at
        assert closed_first is not None, "закрытие обязано проставить момент закрытия"
        assert order.reopened_at is None, "заказ ещё не возвращали — момента возврата быть не может"

        change_status(order, to_code=work.code, actor_type="staff")
        order.refresh_from_db()
        assert order.closed_at is None, "возвращённый в работу заказ не закрыт — момент закрытия обязан стереться"
        assert order.reopened_at is not None, "возврат обязан запомниться полем, а не выводиться из журнала"
        assert order.reopened_at >= closed_first, "возврат не может случиться раньше закрытия"

        change_status(order, to_code=done.code, actor_type="staff")
        order.refresh_from_db()
        assert order.closed_at is not None
        assert order.closed_at > closed_first, (
            "повторное закрытие — НОВЫЙ момент закрытия; старый означал бы, "
            "что смена отчиталась о работе, которой в ней не было"
        )


def test_a_cancelled_order_is_never_returned_to_work(crystal):
    with tenant_context(crystal):
        order = _order()
        cancelled = _terminal(order, cancelled=True)
        work = _working(order)

        change_status(
            order, to_code=cancelled.code, actor_type="staff", cancel_reason="mistake"
        )
        with pytest.raises(ConflictError) as failure:
            change_status(order, to_code=work.code, actor_type="staff")
        assert failure.value.code == "order_cancelled"

        order.refresh_from_db()
        assert order.status_id == cancelled.pk, "отказ обязан оставить заказ там, где он был"


def test_moving_between_two_terminal_statuses_does_not_move_the_closing_moment(crystal):
    """«Доставлено» → «Отменён»: заказ не открывался, закрытие было раньше."""
    with tenant_context(crystal):
        order = _order()
        done = _terminal(order, cancelled=False)
        cancelled = _terminal(order, cancelled=True)

        change_status(order, to_code=done.code, actor_type="staff")
        order.refresh_from_db()
        closed = order.closed_at

        change_status(
            order, to_code=cancelled.code, actor_type="staff", cancel_reason="mistake"
        )
        order.refresh_from_db()
        assert order.closed_at == closed, (
            "переход из закрытого в закрытый сдвинул бы закрытие в будущее "
            "у заказа, который давно закрыт"
        )


def test_the_journal_shows_a_rollback_as_a_rollback(crystal):
    with tenant_context(crystal):
        order = _order()
        done = _terminal(order, cancelled=False)
        work = _working(order)

        change_status(order, to_code=done.code, actor_type="staff")
        change_status(order, to_code=work.code, actor_type="staff", actor_id=None)

        last = OrderStatusChange.objects.filter(order=order).order_by("created_at").last()
        assert last.from_status_id == done.pk
        assert last.to_status_id == work.pk
        assert last.is_rollback is True, "движение назад по потоку — откат, и журнал обязан это знать"
        assert last.actor_type == "staff", "вернул человек — не «система»"


def test_the_main_button_stays_the_next_step_not_a_rollback(crystal):
    """
    Первый в списке — то, что карточка сделает ГЛАВНОЙ КНОПКОЙ.

    Если возврат встанет первым, повар в спешке нажмёт «Новый» вместо «В пути»,
    а обычный ход смены уедет в меню «Ещё действия».
    """
    with tenant_context(crystal):
        order = _order()
        change_status(order, to_code="preparing", actor_type="staff")
        order.refresh_from_db()

        codes = [status.code for status in next_statuses(order)]
        assert codes == ["on_the_way", "done", "accepted", "new"], (
            "сначала вперёд по потоку, затем возврат ближайшим первым"
        )


def test_overdue_is_counted_from_the_return_to_work_not_from_creation(crystal):
    """
    Заказ, пролежавший закрытым сутки и возвращённый минуту назад, НЕ просрочен.

    Иначе возврат на доску всегда красный: карточка приезжает уже опоздавшей на
    всё время, что она лежала закрытой, — и красный цвет перестаёт значить
    «этим надо заняться сейчас».
    """
    with tenant_context(crystal):
        order = _order()
        done = _terminal(order, cancelled=False)
        work = _working(order)
        # Создан сутки назад — по старому счёту это просрочка на сутки.
        Order.objects.filter(pk=order.pk).update(
            created_at=timezone.now() - timedelta(days=1)
        )
        order.refresh_from_db()

        change_status(order, to_code=done.code, actor_type="staff")
        change_status(order, to_code=work.code, actor_type="staff")
        order.refresh_from_db()

        card = serialize_tracker_order(order)
        assert card["waiting_minutes"] >= 24 * 60, (
            "возраст заказа считается от создания — гость ждёт с момента заказа"
        )
        assert card["is_overdue"] is False, (
            "норма времени меряет работу, а работа началась минуту назад"
        )
        assert card["overdue_minutes"] is None


def test_the_shift_and_the_analytics_read_the_same_closing_moment(crystal):
    """
    Один заказ, закрытый ДВАЖДЫ, — и два экрана обязаны назвать одно время.

    Раньше сводка брала первое терминальное событие журнала, а аналитика —
    последнее. Ровно этот заказ их и развёл бы: закрыт, возвращён, закрыт
    снова. Смена отчитывается за ПОСЛЕДНЮЮ работу, потому что первая была
    отменена возвратом.
    """
    with tenant_context(crystal):
        order = _order()
        done = _terminal(order, cancelled=False)
        work = _working(order)

        change_status(order, to_code=done.code, actor_type="staff")
        change_status(order, to_code=work.code, actor_type="staff")
        change_status(order, to_code=done.code, actor_type="staff")
        order.refresh_from_db()

        journal = list(
            OrderStatusChange.objects.filter(order=order, to_status__is_terminal=True)
            .order_by("created_at")
            .values_list("created_at", flat=True)
        )
        assert len(journal) == 2, "в журнале обязаны остаться ОБА закрытия — это история"
        assert journal[0] != journal[1]

        moment = closing_moment(order)
        assert moment == order.closed_at
        # Поле и запись журнала пишутся подряд в одной транзакции и расходятся
        # на микросекунды — сравнивать их на точное равенство значило бы
        # проверять скорость машины. Важно другое: момент закрытия относится к
        # ВТОРОМУ закрытию, а не к первому.
        assert abs((moment - journal[1]).total_seconds()) < 1, (
            "закрытием считается последнее, а не первое: первое отменено возвратом"
        )
        assert (moment - journal[0]).total_seconds() > 0


def test_a_rollback_tells_the_staff_and_sends_the_guest_nothing(
    crystal, django_capture_on_commit_callbacks
):
    """
    РЕШЕНИЕ ПО УВЕДОМЛЕНИЯМ, ЗАКРЕПЛЁННОЕ ПРОВЕРКОЙ.

    Гостю на откате не уходит НИЧЕГО: разослать «ваш заказ снова готовится»
    после «доставлено» значит превратить исправление ошибки кухни в новость для
    гостя. Экран гостя при этом обновится сам — но экран показывает правду, а
    не шлёт сообщение.

    Персонал же обязан узнать: событие смены статуса уходит на канал точки, то
    есть карточка возвращается на доски всех, кто сейчас на смене. Без события
    заказ ожил бы только у того, кто нажал.
    """
    from apps.events.bus import ORDER_STATUS_CHANGED, subscribe
    from apps.notifications.models import NotificationLog

    with tenant_context(crystal):
        order = _order()
        done = _terminal(order, cancelled=False)
        work = _working(order)
        change_status(order, to_code=done.code, actor_type="staff")

        seen: list = []
        subscribe(ORDER_STATUS_CHANGED)(lambda event: seen.append(event))
        before = NotificationLog.objects.filter(order=order).count()

        # События уходят ПОСЛЕ коммита — без этого блока подписчиков не позовут
        # и проверка молчала бы о чём угодно.
        with django_capture_on_commit_callbacks(execute=True):
            change_status(order, to_code=work.code, actor_type="staff")

        assert NotificationLog.objects.filter(order=order).count() == before, (
            "откат не имеет права породить ни одной отправки"
        )
        rollbacks = [
            event
            for event in seen
            if event.payload.get("from_status") == done.code
            and event.payload.get("to_status") == work.code
        ]
        assert len(rollbacks) == 1, "персонал узнаёт об откате событием, и ровно одним"
        assert rollbacks[0].payload.get("execution_point_id"), (
            "без точки событие не дойдёт до доски смены — только до самого заказа"
        )


def test_the_card_journal_names_who_went_back_and_from_where(crystal):
    """
    Журнал на карточке отвечает на три вопроса разбора смены: кто, откуда, куда.

    Гостевой таймлайн на них не отвечает и не должен: он показывает ПУТЬ
    заказа, а не то, что с ним делали руками.
    """
    with tenant_context(crystal):
        order = _order()
        done = _terminal(order, cancelled=False)
        work = _working(order)
        chef = User.objects.get(email=f"chef@{crystal.subdomain}.local")

        change_status(order, to_code=done.code, actor_type="staff", actor_id=chef.pk)
        change_status(order, to_code=work.code, actor_type="staff", actor_id=chef.pk)
        order.refresh_from_db()

        journal = serialize_tracker_order(order)["journal"]
        assert [entry["to"] for entry in journal][-2:] == [done.code, work.code]

        back = journal[-1]
        assert back["from"] == done.code, "«откуда» — половина ответа на вопрос, что случилось"
        assert back["is_rollback"] is True
        assert back["actor_type"] == "staff"
        assert back["actor_name"] == (chef.full_name or chef.email), (
            "разбор смены начинается с имени, а не с идентификатора"
        )

        forward = journal[-2]
        assert forward["is_rollback"] is False, "шаг вперёд откатом не считается"
