"""
РАЗДЕЛ «ЗАКАЗЫ» ОТЕЛЯ: все заведения сразу, с фильтрами и цифрами по выборке.

Зачем он отдельно от истории доски. История — рабочий экран ОДНОГО заведения:
повар смотрит, что было на его кухне. Раздел «Заказы» отвечает на вопрос
управляющего и администратора — «что вообще происходило в отеле», по всем
заведениям сразу, за любой период. Это разные вопросы, и объединять их в один
экран значило бы заставить повара листать спа.

ПЕРЕИСПОЛЬЗУЕТСЯ ВСЁ, ЧТО МОЖНО:
  * отбор и сортировка истории — `tracker._history_queryset` (момент закрытия,
    запасной ключ для заказов без него);
  * сужение — `tracker._narrow` (статус, исполнитель, тип, комната);
  * цифры — `selection.selection_summary`;
  * листание — курсором, как во всех растущих списках (`core/listing`).
Двадцатого своего механизма здесь нет.

РЕЖЕТСЯ ПО ПРАВАМ ТАК ЖЕ, КАК ОСТАЛЬНАЯ CMS: администратор видит отель
целиком, управляющий — свои заведения. Признак берётся из `roles`, второго
источника правды о подведомственности не появляется.
"""

from __future__ import annotations

from django.db.models import Q
from django.utils.dateparse import parse_datetime

from apps.accounts.services.roles import managed_point_ids_or_none, require_cms_access
from apps.hotels.models import ExecutionPoint, Hotel
from apps.orders.models import Order
from apps.orders.services.selection import selection_summary


def _visible_points() -> list[ExecutionPoint]:
    """Заведения, о которых этот человек вправе спрашивать."""
    points = ExecutionPoint.objects.filter(is_active=True).order_by("code")
    managed = managed_point_ids_or_none()
    if managed is not None:
        points = points.filter(pk__in=managed)
    return list(points)


def list_orders(
    *,
    hotel: Hotel,
    language: str | None = None,
    point: str = "",
    since: str = "",
    until: str = "",
    status: str = "",
    assignee: str = "",
    order_type: str = "",
    room: str = "",
    search: str = "",
    cursor: str | None = None,
    limit: int | None = None,
) -> dict:
    """
    Список заказов отеля с фильтрами, цифрами по выборке и листанием курсором.

    Заказы-агрегаты (`parent`) исключены: гостевой заказ, разъехавшийся на два
    заведения, иначе считался бы трижды — сам и оба своих исполнения.
    """
    from apps.orders.services import tracker

    require_cms_access()

    allowed = _visible_points()
    allowed_ids = {str(item.pk) for item in allowed}

    queryset = (
        tracker.order_queryset()
        .exclude(children__isnull=False)
        .select_related("assignee", "execution_point", "room")
        .filter(execution_point_id__in=allowed_ids)
    )

    # Фильтр по заведению — только внутри разрешённых: чужое заведение в
    # адресе не должно ни отдавать данные, ни выглядеть пустым разделом.
    if point and str(point) in allowed_ids:
        queryset = queryset.filter(execution_point_id=point)

    term = (search or "").strip()
    if term:
        condition = Q(room__number__icontains=term)
        if term.isdigit():
            condition |= Q(number=int(term))
        queryset = queryset.filter(condition)

    queryset = tracker._narrow(
        queryset,
        None,
        assignee=assignee,
        order_type=order_type,
        room=room,
        status=status,
    )
    queryset = tracker._history_queryset(
        queryset,
        since=tracker._day_edge(since, hotel, end=False),
        until=tracker._day_edge(until, hotel, end=True),
    )

    page_size = max(1, min(int(limit or 50), 200))
    paged = queryset
    if cursor:
        at, _, cursor_id = cursor.partition("|")
        moment = parse_datetime(at.replace(" ", "+")) if at else None
        if moment and cursor_id:
            paged = paged.filter(
                Q(closed_key__lt=moment) | Q(closed_key=moment, pk__lt=cursor_id)
            )

    rows = list(paged[: page_size + 1])
    has_more = len(rows) > page_size
    rows = rows[:page_size]
    next_cursor = (
        f"{rows[-1].closed_key.isoformat()}|{rows[-1].pk}" if has_more and rows else None
    )

    actors = tracker.actor_names(rows)
    return {
        "orders": [
            tracker.serialize_tracker_order(order, language, None, actors) for order in rows
        ],
        # Цифры СЧИТАЮТСЯ ПО ВЫБОРКЕ, а не по странице: «заказов 50» на первой
        # странице из тысячи — это враньё счётчиком, которое у нас уже было.
        "summary": selection_summary(queryset.order_by()),
        "next_cursor": next_cursor,
        "points": [
            {
                "id": str(item.pk),
                "code": item.code,
                "title": item.title_i18n or item.code,
            }
            for item in allowed
        ],
    }
