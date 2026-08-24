"""
Реестр типов трекеров.

Здесь — ЕДИНСТВЕННОЕ место, где система знает, чем доска ресторана отличается
от очереди хозслужбы. Прикладной код спрашивает у реестра поведение, а не
сравнивает тип сервиса со строкой:

    behaviour = tracker_behaviour(point)
    if behaviour.layout == Layout.TIMELINE:   # а НЕ: if service.type == "spa"
        ...

Тип трекера ВЫВОДИТСЯ из типа сервиса (карта продукта, Часть 3), а не хранится
отдельным полем: два источника правды разошлись бы на первом же переименовании
сервиса. Сервис ↔ исполнитель 1:1 (R1), поэтому у точки исполнения тип трекера
определён однозначно; точка без сервиса (теоретический случай) падает на свой
род (ExecutionPoint.Kind).

Правило на будущее: новый вид сервиса — это новая строка в SERVICE_TYPE_TO_TRACKER
и, если он работает иначе, новая строка в BEHAVIOURS. Если вид потребовал форка
доски, действий или потока статусов в прикладном коде, значит треснула модель.

Поток статусов у каждого типа свой — apps/orders/status_flows.py.
"""

from __future__ import annotations

import dataclasses

from django.db import models


class TrackerType(models.TextChoices):
    BOARD = "board", "Доска заказов"
    QUEUE = "queue", "Очередь заявок"
    SCHEDULE = "schedule", "Записи на сегодня"
    REQUESTS = "requests", "Заявки на подачу"


class Layout(models.TextChoices):
    """Как клиент рисует задачи. Сервер говорит чем, а не как именно."""

    COLUMNS = "columns", "Колонки по статусам"
    TIMELINE = "timeline", "Лента по времени"


# Порог просрочки, когда его не задали ни точке, ни виду работы. Ровно то
# число, которое стояло значением по умолчанию у поля до миграции 0023, —
# «доска без особых требований».
DEFAULT_SLA_MINUTES = 20


class GroupBy(models.TextChoices):
    """
    ПО ЧЕМУ СОБИРАЮТСЯ ЗАДАЧИ.

    По статусу — как было: заказ едет по этапам, и колонка отвечает на вопрос
    «что с ним сейчас». По комнате — для хозслужбы: горничная идёт по этажу, и
    две заявки в один номер это ОДИН поход, а не два. Раньше они приезжали
    двумя карточками, и вторую находили, уже выйдя из номера.
    """

    STATUS = "status", "По статусу"
    ROOM = "room", "По номеру"


class ColumnStyle(models.TextChoices):
    """
    Сколько колонок рисовать.

    MANY — набор по статусам потока. SINGLE — одна лента: у заявок ресепшена
    статусов всего два, и «Новая» с «Подтверждена» делили экран пополам,
    оставаясь при этом полупустыми. Одна лента честнее занимает место.
    """

    MANY = "many", "Колонки по статусам"
    SINGLE = "single", "Одна лента"


@dataclasses.dataclass(frozen=True, slots=True)
class TrackerBehaviour:
    code: str
    layout: str
    # По какому полю сортируются задачи в активном скоупе. У записей это время
    # начала слота: спа-мастер смотрит «кто следующий», а не «что раньше
    # заказали». У остальных — момент создания, как было у кухни.
    order_by: str
    # Показывать ли колонку-корзину терминальных статусов. У ленты записей
    # завершённые остаются на месте (день видно целиком), у досок — уходят.
    keeps_terminal_in_view: bool
    # По чему собираются задачи и сколько колонок рисовать. Оба поля живут
    # ЗДЕСЬ, а не в прикладном коде: `if service.type == "housekeeping"` в
    # сборке доски — это и есть трещина, ради устранения которой реестр писался.
    group_by: str = GroupBy.STATUS
    column_style: str = ColumnStyle.MANY
    # Порог просрочки, если у вида работы он свой. `None` — берём настройку
    # точки. Ноль в этом поле означал бы «просрочено всё», поэтому именно None.
    sla_minutes: int | None = None


BEHAVIOURS: dict[str, TrackerBehaviour] = {
    TrackerType.BOARD: TrackerBehaviour(
        code=TrackerType.BOARD,
        layout=Layout.COLUMNS,
        order_by="created_at",
        keeps_terminal_in_view=False,
    ),
    TrackerType.QUEUE: TrackerBehaviour(
        code=TrackerType.QUEUE,
        layout=Layout.COLUMNS,
        order_by="created_at",
        keeps_terminal_in_view=False,
        # Хозслужба работает ПО НОМЕРАМ, а не по заказам: маршрут горничной —
        # это этаж, а не очередь поступления.
        group_by=GroupBy.ROOM,
    ),
    TrackerType.SCHEDULE: TrackerBehaviour(
        code=TrackerType.SCHEDULE,
        layout=Layout.TIMELINE,
        order_by="slot_start",
        keeps_terminal_in_view=True,
    ),
    TrackerType.REQUESTS: TrackerBehaviour(
        code=TrackerType.REQUESTS,
        layout=Layout.COLUMNS,
        order_by="created_at",
        keeps_terminal_in_view=False,
        # Две колонки на два статуса делили экран пополам и стояли полупустыми.
        column_style=ColumnStyle.SINGLE,
        # Заказать билеты не делается за двадцать минут. Порог кухни здесь
        # красил бы просрочкой всё подряд, а тревога, включённая всегда, не
        # значит ничего. У консьержа и ресепшена свой — четыре часа.
        sla_minutes=240,
    ),
}


# Тип сервиса (hotels.Service.Type) → тип трекера. Рум-сервис и мини-бар —
# те же доски заказов: у них каталог и та же работа «принял → отдал».
SERVICE_TYPE_TO_TRACKER: dict[str, str] = {
    "restaurant": TrackerType.BOARD,
    "bar": TrackerType.BOARD,
    "room_service": TrackerType.BOARD,
    "minibar": TrackerType.BOARD,
    "housekeeping": TrackerType.QUEUE,
    "spa": TrackerType.SCHEDULE,
    "pool": TrackerType.SCHEDULE,
    "excursions": TrackerType.SCHEDULE,
    "transfer": TrackerType.REQUESTS,
    "concierge": TrackerType.REQUESTS,
    # info у гостя без действия, custom — свой набор кирпичей; и то и другое
    # обслуживается доской: она не навязывает ни слотов, ни формы.
    "info": TrackerType.BOARD,
    "custom": TrackerType.BOARD,
}

# Падение для точки исполнения без сервиса. Держать синхронным с
# hotels/venue_defaults.py::KIND_TO_SERVICE_TYPE — это его продолжение.
POINT_KIND_TO_TRACKER: dict[str, str] = {
    "kitchen": TrackerType.BOARD,
    "bar": TrackerType.BOARD,
    "housekeeping": TrackerType.QUEUE,
    "spa": TrackerType.SCHEDULE,
    "reception": TrackerType.REQUESTS,
    "other": TrackerType.BOARD,
}


def tracker_type_for_service_type(service_type: str) -> str:
    """Неизвестный тип сервиса — доска: самый нейтральный набор правил."""
    return SERVICE_TYPE_TO_TRACKER.get(service_type, TrackerType.BOARD)


def tracker_type_for_point(point) -> str:
    """
    Тип трекера точки исполнения.

    Сервис читается через кэш `_prefetched_objects_cache`, если вызывающий уже
    сделал prefetch: доска зовёт это на каждую точку в списке.
    """
    service = _service_of(point)
    if service is not None:
        return tracker_type_for_service_type(service.type)
    return POINT_KIND_TO_TRACKER.get(point.kind, TrackerType.BOARD)


def _service_of(point):
    cache = getattr(point, "_prefetched_objects_cache", None) or {}
    if "services" in cache:
        return next(iter(cache["services"]), None)
    return point.services.first()


def effective_sla_minutes(point) -> int:
    """
    ПОРОГ ПРОСРОЧКИ ТОЧКИ — ОДНО МЕСТО НА ВСЕХ ЧИТАТЕЛЕЙ.

    Его спрашивают карточка (`is_overdue`, `overdue_minutes`), фильтр
    «только просроченные», плитка сводки и подпись под доской. Четыре ответа
    на один вопрос обязаны совпадать, поэтому ответ здесь один.

    Правило простое, потому что намерение теперь ХРАНИТСЯ: заполненный порог —
    это выбор оператора, и он побеждает; пустой (`None`) означает «не задавали»,
    и тогда берётся умолчание вида работы. Заказать билеты не делается за
    двадцать минут, и порог кухни красил бы у консьержа просрочкой вообще всё.

    Раньше различить «выбрал двадцать» и «не трогал» было нечем — у поля стояло
    значение по умолчанию, и код принимал его за «не трогали», ошибаясь ровно у
    тех, кто выбрал двадцать осознанно. Поле стало nullable (миграция
    hotels.0023), и догадка больше не нужна.

    Вид работы без своего умолчания (доски кухни и бара) падает на прежнее
    число — оно остаётся общим ответом «по умолчанию двадцать».
    """
    behaviour = tracker_behaviour(point)
    if point.sla_minutes is not None:
        return point.sla_minutes
    return behaviour.sla_minutes if behaviour.sla_minutes is not None else DEFAULT_SLA_MINUTES


def tracker_behaviour(point) -> TrackerBehaviour:
    return BEHAVIOURS[tracker_type_for_point(point)]


def behaviour_for_type(tracker_type: str) -> TrackerBehaviour:
    return BEHAVIOURS.get(tracker_type, BEHAVIOURS[TrackerType.BOARD])


class GuestCard(models.TextChoices):
    """
    Чем карточка заказа отвечает ГОСТЮ.

    Тот же вопрос, что у трекера, но с другой стороны стойки: трекер решает, как
    персоналу вести работу, карточка — какие поля показать тому, кто заказал.
    Живут они в ОДНОМ реестре и читают ОДИН вход (`Service.Type`), иначе на
    первом же переименовании сервиса гость и трекер разошлись бы в том, что это
    вообще за заявка.

    Карточка была одна на все сервисы, и запись на массаж показывалась полями
    доставки: «Куда — Номер 305», «Когда — как можно скорее», «подадут к 01:21».
    Сеанс при этом стоял в календаре на 11:00 — и лежал ниже, в позиции.
    """

    BOOKING = "booking", "Запись по слоту"
    DELIVERY = "delivery", "Доставка"
    RIDE = "ride", "Поездка"
    REQUEST = "request", "Заявка"


# Тип сервиса → вид гостевой карточки. Ключи те же, что у трекеров: добавили
# сервис — добавили строку в обе карты, иначе тест ниже покажет пропуск.
SERVICE_TYPE_TO_GUEST_CARD: dict[str, str] = {
    "restaurant": GuestCard.DELIVERY,
    "bar": GuestCard.DELIVERY,
    "room_service": GuestCard.DELIVERY,
    "minibar": GuestCard.DELIVERY,
    "spa": GuestCard.BOOKING,
    "pool": GuestCard.BOOKING,
    "excursions": GuestCard.BOOKING,
    "transfer": GuestCard.RIDE,
    "concierge": GuestCard.REQUEST,
    "housekeeping": GuestCard.REQUEST,
    # info гостю без действия; custom собирается из своих кирпичей — и то и
    # другое честнее показать заявкой: она не обещает ни времени подачи, ни
    # маршрута, которых у сервиса может не быть.
    "info": GuestCard.REQUEST,
    "custom": GuestCard.REQUEST,
}


def guest_card_for_service_type(service_type: str) -> str:
    """Неизвестный тип сервиса — заявка: карточка, ничего не обещающая сверх статуса."""
    return SERVICE_TYPE_TO_GUEST_CARD.get(service_type, GuestCard.REQUEST)


def guest_card_for_point(point) -> str:
    service = _service_of(point)
    if service is not None:
        return guest_card_for_service_type(service.type)
    return _POINT_KIND_TO_GUEST_CARD.get(point.kind, GuestCard.REQUEST)


# Падение для точки без сервиса — продолжение POINT_KIND_TO_TRACKER.
_POINT_KIND_TO_GUEST_CARD: dict[str, str] = {
    "kitchen": GuestCard.DELIVERY,
    "bar": GuestCard.DELIVERY,
    "housekeeping": GuestCard.REQUEST,
    "spa": GuestCard.BOOKING,
    "reception": GuestCard.REQUEST,
    "other": GuestCard.REQUEST,
}


def guest_card_for_order(order) -> str:
    """
    Вид карточки конкретного заказа.

    Забронированный слот делает карточку записью независимо от типа сервиса:
    слот — это факт заказа, а не свойство сервиса, и «как можно скорее» рядом с
    назначенным временем было бы прямым враньём. Всё остальное решает тип
    сервиса из реестра.

    Заказ с позициями у сервиса-заявки остаётся заявкой: полотенца приносят по
    заявке хозслужбы, и «ожидаемое время подачи» там обещает то, чего никто не
    обещал.
    """
    if order.slot_bookings.exists():
        return GuestCard.BOOKING
    point = getattr(order, "execution_point", None)
    return guest_card_for_point(point) if point is not None else GuestCard.REQUEST
