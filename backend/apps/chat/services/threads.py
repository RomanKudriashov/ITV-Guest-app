"""
Сервисный слой чата: тред гостя, права персонала, снимок для реконсиляции,
отправка.

Снимок — единый формат для REST и WS, чтобы клиент не собирал состояние из
двух источников. `mine` вычисляется по стороне запроса: одно и то же сообщение
«моё» для его автора и «чужое» для другой стороны.
"""

from __future__ import annotations


from django.db import IntegrityError, transaction
from django.db.models import Count, Exists, OuterRef, Q, Subquery
from django.db.models.functions import Coalesce
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.core.context import require_hotel_id
from apps.core.errors import NotFoundError, PermissionDenied, ValidationError
from apps.events.bus import CHAT_MESSAGE, emit

from apps.chat.models import ChatMessage, ChatThread

MAX_BODY = 2000


# --- Тред ------------------------------------------------------------------


def get_or_create_thread(guest_session) -> ChatThread:
    """
    Тред гостя — ТРЕД СЕССИИ, а не номера.

    Раньше тред жил «при номере» и перепривязывался к каждой новой сессии этого
    номера: следующий гость номера 305 открывал чат и видел переписку
    предыдущего — чужие заказы, чужие жалобы, ответ отеля на чужой отзыв
    (проверено: после выезда новый гость читал сообщения прежнего).

    Номер в треде остаётся — персоналу видно, откуда пишут. Старые треды не
    удаляются: они нужны для разбора отзывов, персонал их по-прежнему видит.
    """
    thread = ChatThread.objects.filter(guest_session_id=guest_session.pk).first()
    if thread is not None:
        return thread
    # ГОНКА: первое открытие чата и сокет приходят одновременно. Уникальность
    # в базе не даёт завести второй тред; проигравший берёт тред победителя.
    try:
        with transaction.atomic():
            return ChatThread.objects.create(
                room_id=guest_session.room_id,
                guest_session=guest_session,
                execution_point=_default_point(),
            )
    except IntegrityError:
        return ChatThread.objects.get(guest_session_id=guest_session.pk)


def unread_for_guest(guest_session) -> int:
    """
    Непрочитанные гостем — БЕЗ создания треда.

    Главная витрины спрашивает счётчик на каждом открытии, и раньше заводила
    ради него тред: на стенде 4075 тредов, сообщения — в 16. Тред появляется,
    когда гость открывает чат или пишет, а не когда смотрит главную.
    """
    return ChatMessage.objects.filter(
        thread__guest_session_id=guest_session.pk,
        author_type="staff",
        read_by_guest_at__isnull=True,
    ).count()


def _default_point():
    """Куда по умолчанию идёт чат: ресепшн/консьерж, иначе любой отдел."""
    from apps.hotels.models import ExecutionPoint

    return reception_point() or ExecutionPoint.objects.filter(is_active=True).order_by("code").first()


# --- Кто читает чат --------------------------------------------------------


def reception_point():
    """
    Ресепшен отеля — ЯВНАЯ точка с кодом `reception`; нет её — первая по коду
    точка вида «ресепшен». Прежний выбор брал любую точку этого вида, и в
    «Кристалле» чат уходил консьержу (у него тоже вид «ресепшен»).
    """
    from apps.hotels.models import ExecutionPoint

    active = ExecutionPoint.objects.filter(is_active=True)
    return (
        active.filter(code="reception").first()
        or active.filter(kind=ExecutionPoint.Kind.RECEPTION).order_by("code").first()
    )


def can_read_chat(access=None) -> bool:
    """
    ЧАТ ГОСТЕЙ ЧИТАЮТ РЕСЕПШЕН И АДМИНИСТРАТОР — больше никто.

    До волны 9 ручка тредов пускала любого, кто вошёл в трекер: повар и
    горничная читали все переписки отеля со всеми сообщениями. Утечка того же
    класса, что тред «на номер» (волна 8), только шире.
    """
    from apps.accounts.services.roles import current_access

    access = access or current_access()
    if access.unrestricted:
        return True
    point = reception_point()
    return point is not None and str(point.pk) in access.member_point_ids


def require_chat_access() -> None:
    if not can_read_chat():
        raise PermissionDenied(
            "Переписку с гостями ведёт ресепшен", code="chat_forbidden"
        )


def handover_targets(me) -> list[dict]:
    """
    Кому можно передать диалог: те, кто ВПРАВЕ его читать, — смена ресепшена.

    Список строится из того же правила, что и доступ к чату (`can_read_chat`),
    а не из своего: второй список разошёлся бы с первым, и однажды диалог
    передали бы тому, кто его не откроет.
    """
    from apps.accounts.models import StaffAssignment, User

    point = reception_point()
    if point is None:
        return []
    user_ids = StaffAssignment.objects.filter(
        execution_point_id=point.pk, is_active=True
    ).values_list("user_id", flat=True)
    people = (
        User.objects.filter(pk__in=list(user_ids), is_active=True, is_staff_member=True)
        .exclude(pk=getattr(me, "pk", None))
        .order_by("full_name", "email")
    )
    return [
        {"id": str(user.pk), "name": user.full_name or user.email}
        for user in people
    ]


def get_thread(thread_id) -> ChatThread:
    thread = ChatThread.objects.filter(pk=thread_id).first()
    if thread is None:
        raise NotFoundError("Тред не найден")
    return thread


# --- Снимок ----------------------------------------------------------------


def _reply_hours() -> dict | None:
    """
    Когда ресепшен отвечает. Считается тем же механизмом, что часы заведения
    на витрине: у отеля своё расписание, и второй способ считать «открыто»
    однажды разошёлся бы с первым.
    """
    from apps.catalog.services.availability import service_availability

    point = reception_point()
    service = point.services.first() if point is not None else None
    if service is None or service.schedule_id is None:
        return None
    state = service_availability(service)
    return {
        "is_open": state.is_available,
        "opens_at": state.available_at.isoformat() if state.available_at else None,
        "opens_time": state.available_from,
        "until": state.available_until,
    }


def _counterpart(thread: ChatThread) -> str:
    """
    Кто отвечает гостю — ОТДЕЛ, а не человек: «Ресепшен», не «Игорь».

    Гость не должен привязываться к сотруднику (завтра его смена не его), а
    смена не должна путаться, чьё это обещание. Имена видит только персонал.
    """
    from apps.core.context import current_language
    from apps.core.fields import translate

    point = thread.execution_point
    if point is None:
        return "Ресепшен"
    return translate(point.title, current_language()) or point.code


def thread_snapshot(thread: ChatThread, *, side: str) -> dict:
    """side: 'guest' | 'staff' — от этого зависят `mine`, подписи и счётчик непрочитанных."""
    messages = list(thread.messages.all())
    unread = sum(
        1
        for message in messages
        if message.author_type != side
        and (message.read_by_staff_at if side == "staff" else message.read_by_guest_at) is None
    )
    counterpart = _counterpart(thread)

    def author(message) -> str:
        if message.author_type == "guest":
            return message.author_name or "Гость"
        if side == "guest":
            return counterpart
        return message.author_name or "Персонал"

    return {
        "thread_id": str(thread.pk),
        "room": thread.room.number if thread.room_id else None,
        # Шапка переписки: гостю — отдел, персоналу — отдел тоже (кто по ту
        # сторону от гостя), номер — отдельным полем.
        "counterpart": counterpart,
        # Часы ресепшена: закрыт — гость видит «ответим с 07:00», а не тишину.
        # Расписания нет — работает всегда, и обещаний не даём.
        **({"reply_hours": _reply_hours()} if side == "guest" else {}),
        "messages": [
            {
                "id": str(message.pk),
                "author_type": message.author_type,
                "author_name": author(message),
                "body": message.body,
                "created_at": message.created_at.isoformat(),
                "mine": message.author_type == side,
            }
            for message in messages
        ],
        "unread": unread,
        # Персоналу — кто ведёт диалог (гостю — никогда: ему отвечает отдел).
        # `is_me` здесь не посчитать — снимок уходит всем по сокету; фронт
        # сравнивает `holder.id` со своим.
        **({"holder": _holder(thread)} if side == "staff" else {}),
    }


def _holder(thread):
    from apps.chat.services.holding import holder_payload

    return holder_payload(thread)


# --- Отправка --------------------------------------------------------------


def _post_message(thread: ChatThread, *, author_type: str, author_id, author_name: str, body: str) -> ChatMessage:
    body = (body or "").strip()
    if not body:
        raise ValidationError("Пустое сообщение", field="body")
    if len(body) > MAX_BODY:
        raise ValidationError("Слишком длинное сообщение", field="body")

    with transaction.atomic():
        message = ChatMessage.objects.create(
            hotel_id=require_hotel_id(),
            thread=thread,
            author_type=author_type,
            author_id=author_id,
            author_name=author_name[:128],
            body=body,
        )
        stamps = {"last_message_at": message.created_at}
        stamps["last_guest_message_at" if author_type == "guest" else "last_staff_message_at"] = message.created_at
        ChatThread.objects.filter(pk=thread.pk).update(**stamps)

    if author_type == "guest":
        # Гость ждёт ответа — ставим срок. Ответил ресепшен — задание просто
        # ничего не сделает (см. `unanswered.run`).
        from apps.chat.services.unanswered import schedule_check

        thread.last_guest_message_at = message.created_at
        schedule_check(thread)

    # Событие после коммита: разбудит WS обеих сторон и уведомление получателю.
    emit(
        CHAT_MESSAGE,
        {
            "thread_id": str(thread.pk),
            "message_id": str(message.pk),
            "author_type": author_type,
            "room": thread.room.number if thread.room_id else "",
            "execution_point_id": str(thread.execution_point_id) if thread.execution_point_id else "",
            "preview": body[:120],
        },
        hotel_id=thread.hotel_id,
        actor_type=author_type,
        actor_id=author_id,
    )
    return message


def guest_send(guest_session, body: str) -> dict:
    thread = get_or_create_thread(guest_session)
    _post_message(thread, author_type="guest", author_id=guest_session.pk, author_name="Гость", body=body)
    return thread_snapshot(thread, side="guest")


def staff_send(thread: ChatThread, user, body: str) -> dict:
    name = user.full_name or user.email
    _post_message(thread, author_type="staff", author_id=user.pk, author_name=name, body=body)
    return thread_snapshot(thread, side="staff")


# --- Прочитано -------------------------------------------------------------


def mark_read(thread: ChatThread, *, side: str) -> None:
    now = timezone.now()
    other = "staff" if side == "guest" else "guest"
    field = "read_by_guest_at" if side == "guest" else "read_by_staff_at"
    thread.messages.filter(author_type=other, **{f"{field}__isnull": True}).update(**{field: now})


# --- Персонал: список тредов -----------------------------------------------


THREADS_PAGE = 30
THREADS_PAGE_MAX = 100
# Заводское значение порога ожидания: отель меняет его в настройках чата.
DEFAULT_REPLY_WAIT_MINUTES = 10


def reply_wait_minutes() -> int:
    from apps.hotels.services.hotel import current_hotel

    return getattr(current_hotel(), "chat_reply_minutes", DEFAULT_REPLY_WAIT_MINUTES)


def _waiting_since(thread):
    """Гость ждёт ответа: его последнее сообщение позже последнего ответа."""
    guest_at = thread.last_guest_message_at
    if guest_at is None:
        return None
    staff_at = thread.last_staff_message_at
    return guest_at if staff_at is None or staff_at < guest_at else None


def serialize_thread_row(thread, now=None, me=None, wait_minutes=None) -> dict:
    from apps.chat.services.holding import holder_payload

    wait_minutes = wait_minutes or reply_wait_minutes()

    now = now or timezone.now()
    waiting = _waiting_since(thread)
    waiting_minutes = int((now - waiting).total_seconds() // 60) if waiting else None
    session = thread.guest_session
    return {
        "thread_id": str(thread.pk),
        "room": thread.room.number if thread.room_id else None,
        "language": (session.language or "") if session is not None else "",
        "last_body": (getattr(thread, "last_body", None) or "")[:120],
        "last_at": thread.last_message_at.isoformat() if thread.last_message_at else None,
        "last_guest_at": thread.last_guest_message_at.isoformat() if thread.last_guest_message_at else None,
        "unread": getattr(thread, "unread", 0),
        "waiting_minutes": waiting_minutes,
        "is_late": waiting_minutes is not None and waiting_minutes >= wait_minutes,
        "holder": holder_payload(thread, me, now),
    }


def list_threads(*, cursor: str | None = None, limit: int | None = None) -> dict:
    """
    Диалоги отеля для ресепшена — страницей.

    ПОРЯДОК: сначала те, где есть непрочитанное от гостя; внутри — по
    последнему сообщению ГОСТЯ, свежие сверху. Не по последнему сообщению
    вообще: ответ ресепшена не должен поднимать диалог над гостем, который
    пишет прямо сейчас. Диалоги, где гость не писал ни разу (ответ на отзыв),
    — в конце, по своему последнему сообщению.

    Пустые треды в список не попадают. Листание курсором: новые сообщения
    переставляют диалоги прямо во время просмотра. `unread_total` — по всем
    диалогам, для значка.
    """
    require_chat_access()
    from apps.core.context import current_actor

    me = current_actor()
    page_size = max(1, min(int(limit or THREADS_PAGE), THREADS_PAGE_MAX))
    unread_filter = Q(messages__author_type="guest", messages__read_by_staff_at__isnull=True)
    last_body = ChatMessage.objects.filter(thread=OuterRef("pk")).order_by("-created_at").values("body")[:1]
    has_unread = Exists(
        ChatMessage.objects.filter(thread=OuterRef("pk"), author_type="guest", read_by_staff_at__isnull=True)
    )
    queryset = (
        ChatThread.objects.filter(last_message_at__isnull=False)
        .select_related("room", "guest_session", "holder")
        .annotate(
            unread=Count("messages", filter=unread_filter),
            has_unread=has_unread,
            guest_key=Coalesce("last_guest_message_at", "last_message_at"),
        )
        .order_by("-has_unread", "-guest_key", "-pk")
    )
    if cursor:
        flag, _, rest = cursor.partition("|")
        at, _, cursor_id = rest.partition("|")
        moment = parse_datetime(at.replace(" ", "+")) if at else None
        if flag not in ("0", "1") or moment is None or not cursor_id:
            raise ValidationError("Неверный курсор", field="cursor", code="bad_cursor")
        unread_first = flag == "1"
        after = Q(has_unread=unread_first) & (
            Q(guest_key__lt=moment) | Q(guest_key=moment, pk__lt=cursor_id)
        )
        if unread_first:
            after |= Q(has_unread=False)
        queryset = queryset.filter(after)
    rows = list(queryset.annotate(last_body=Subquery(last_body))[: page_size + 1])
    has_more = len(rows) > page_size
    rows = rows[:page_size]
    unread_total = ChatMessage.objects.filter(
        author_type="guest", read_by_staff_at__isnull=True
    ).count()
    now = timezone.now()
    wait_minutes = reply_wait_minutes()
    next_cursor = None
    if has_more and rows:
        last = rows[-1]
        next_cursor = f"{int(last.has_unread)}|{last.guest_key.isoformat()}|{last.pk}"
    return {
        "items": [serialize_thread_row(thread, now, me, wait_minutes) for thread in rows],
        "next_cursor": next_cursor,
        "unread_total": unread_total,
        "reply_wait_minutes": wait_minutes,
    }
