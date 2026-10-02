"""
КНОПКИ ПОД УВЕДОМЛЕНИЕМ (партия 28, «уровень 2»).

Под личным уведомлением в Telegram — действия, которые человек и так сделал
бы в панели: «Взять в работу» (заказ), «Открыть в трекере» (ссылка),
«Разобрать» (низкая оценка). Бот как рабочее место — не здесь и не сейчас.

ПРАВА — В МОМЕНТ НАЖАТИЯ, ТЕМИ ЖЕ ПРОВЕРКАМИ, ЧТО В ПАНЕЛИ. Кнопка — не
пропуск: за минуты между отправкой и нажатием человека могли снять со смены,
заказ — взять или закрыть. Поэтому нажатие исполняет тот же сервис, что и
панель (`accept_order`, `triage_review`), под тем же человеком: кто нажал,
определяется по аккаунту Telegram среди привязанных В ОТЕЛЕ ЗАКАЗА.

ПОСЛЕ ДЕЙСТВИЯ СООБЩЕНИЕ ПЕРЕПИСЫВАЕТСЯ: «Взял Пётр, 14:32», кнопка действия
пропадает. Опоздавший получает «уже взял Пётр», закрытый заказ — «заказ уже
закрыт». КАЖДОЕ НАЖАТИЕ — В ЖУРНАЛ ДЕЙСТВИЙ: кто, что, когда, чем кончилось.

«ОТКРЫТЬ В ТРЕКЕРЕ» — ТОЛЬКО НА ПУБЛИЧНЫЙ АДРЕС. Отель на локальном адресе
(`guest.localhost`, IP внутренней сети) из Telegram не откроется: вместо
сломанной ссылки кнопки нет вовсе.
"""

from __future__ import annotations

import ipaddress
import logging
import uuid
from urllib.parse import urlparse

from django.utils import timezone

from apps.notifications.messengers import Button, Incoming, Messenger, MessengerError
from apps.notifications.messengers.texts import say

logger = logging.getLogger("apps.notifications")

TAKE = "o"
TRIAGE = "r"
_LOCAL_SUFFIXES = (".localhost", ".local", ".internal", ".lan", ".home.arpa")


# --- Кнопки ----------------------------------------------------------------------


def is_public(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    if not host or host == "localhost" or host.endswith(_LOCAL_SUFFIXES):
        return False
    try:
        return ipaddress.ip_address(host).is_global
    except ValueError:
        # Имя без точки (`backend`) — имя внутри сети, а не адрес в интернете.
        return "." in host


def tracker_url(hotel, order_id) -> str:
    url = hotel.public_guest_url(f"/tracker/order/{order_id}")
    return url if is_public(url) else ""


def order_buttons(order, language: str) -> tuple[Button, ...]:
    from apps.notifications.services.delivery import escalation_should_stop

    buttons = []
    if not escalation_should_stop(order):
        buttons.append(Button(label=say("take", language), action=f"{TAKE}:{order.pk.hex}"))
    url = tracker_url(order.hotel, order.pk)
    if url:
        buttons.append(Button(label=say("open", language), url=url))
    return tuple(buttons)


def event_buttons(code: str, payload: dict, language: str) -> tuple[Button, ...]:
    """Кнопки события журнала. Сообщения чата — без кнопок: это уже рабочее место."""
    order_id = (payload or {}).get("order_id")
    if not order_id:
        return ()
    if code == "order.cancelled":
        from apps.hotels.models import Hotel
        from apps.core.context import require_hotel_id

        url = tracker_url(Hotel.objects.get(pk=require_hotel_id()), order_id)
        return (Button(label=say("open", language), url=url),) if url else ()
    if code == "review.low":
        from apps.reviews.models import Review, TriageStatus

        review = Review.objects.filter(order_id=order_id).only("pk", "triage_status").first()
        if review is not None and review.triage_status == TriageStatus.NEW:
            return (Button(label=say("triage", language), action=f"{TRIAGE}:{review.pk.hex}"),)
    return ()


# --- Нажатие -----------------------------------------------------------------------


def handle_press(bot: Messenger, incoming: Incoming) -> str:
    """
    Исполнить нажатие и ответить человеку. Возвращает итог (он же — в журнал):
    done / already_taken / already_yours / closed / denied / not_linked /
    hotel_off / not_found / stale.
    """
    kind, _, ref = (incoming.data or "").partition(":")
    try:
        object_id = uuid.UUID(hex=ref)
    except ValueError:
        object_id = None
    if kind not in (TAKE, TRIAGE) or object_id is None:
        _answer(bot, incoming, say("stale", incoming.language))
        return "stale"

    # Коды журнала — строками целиком: их видит сторож переводов журнала.
    action = "bot.take" if kind == TAKE else "bot.triage"
    object_type = "order" if kind == TAKE else "review"
    hotel_id = _hotel_of(kind, object_id)
    if hotel_id is None:
        _answer(bot, incoming, say("not_found", incoming.language), alert=True)
        return "not_found"

    from apps.accounts.services import contacts
    from apps.notifications.services import personal

    user = next(
        (u for u in contacts.bound_users("telegram", incoming.sender_id) if u.hotel_id == hotel_id),
        None,
    )
    language = (user.language if user else "") or incoming.language
    if user is None:
        # Чужой отель: аккаунт привязан где-то ещё (или нигде), а сообщение
        # переслали. Права не проверить — значит, и действия нет.
        _audit(hotel_id, None, action, object_type, object_id, "not_linked", incoming)
        _answer(bot, incoming, say("not_linked", language), alert=True)
        return "not_linked"
    if not personal.hotel_allows(hotel_id):
        _audit(hotel_id, user, action, object_type, object_id, "hotel_off", incoming)
        _answer(bot, incoming, say("hotel_off", language), alert=True)
        return "hotel_off"

    from apps.core.context import actor_context, tenant_context

    with tenant_context(hotel_id, language=language), actor_context(user):
        if kind == TAKE:
            result = _take(bot, incoming, user, object_id, language)
        else:
            result = _triage(bot, incoming, user, object_id, language)
    _audit(hotel_id, user, action, object_type, object_id, result, incoming)
    return result


def _hotel_of(kind: str, object_id):
    from apps.core.context import platform_scope

    if kind == TAKE:
        from apps.orders.models import Order as Model
    else:
        from apps.reviews.models import Review as Model
    with platform_scope():
        return (
            Model.all_objects.using("platform")
            .filter(pk=object_id)
            .values_list("hotel_id", flat=True)
            .first()
        )


def _name(user) -> str:
    return (user.full_name or user.email) if user else ""


def _clock(hotel, moment) -> str:
    return hotel.to_local(moment or timezone.now()).strftime("%H:%M")


def _take(bot, incoming, user, order_id, language) -> str:
    from apps.accounts.models import User
    from apps.core.errors import ConflictError, NotFoundError, PermissionDenied
    from apps.orders.models import Order
    from apps.orders.services.tracker import accept_order

    try:
        order = accept_order(user, order_id)
    except NotFoundError:
        _answer(bot, incoming, say("not_found", language), alert=True)
        return "not_found"
    except PermissionDenied:
        _answer(bot, incoming, say("denied", language), alert=True)
        return "denied"
    except ConflictError as exc:
        order = Order.objects.select_related("hotel").filter(pk=order_id).first()
        if order is None:
            _answer(bot, incoming, say("not_found", language), alert=True)
            return "not_found"
        open_only = [b for b in order_buttons(order, language) if b.url]
        if exc.code == "already_accepted":
            assignee = User.objects.filter(pk=order.assignee_id).first()
            line = say("taken_by", language, name=_name(assignee), time=_clock(order.hotel, order.accepted_at))
            _rewrite(bot, incoming, line, open_only)
            if order.assignee_id == user.pk:
                _answer(bot, incoming, say("already_yours", language))
                return "already_yours"
            _answer(bot, incoming, say("already_taken", language, name=_name(assignee)), alert=True)
            return "already_taken"
        _rewrite(bot, incoming, say("order_closed_line", language), open_only)
        _answer(bot, incoming, say("order_closed", language), alert=True)
        return "closed"

    line = say("taken_by", language, name=_name(user), time=_clock(order.hotel, order.accepted_at))
    _rewrite(bot, incoming, line, [b for b in order_buttons(order, language) if b.url])
    _answer(bot, incoming, say("taken_ok", language))
    return "done"


def _triage(bot, incoming, user, review_id, language) -> str:
    from apps.accounts.services.roles import require_cms_access
    from apps.core.errors import NotFoundError, PermissionDenied, ValidationError
    from apps.hotels.models import Hotel
    from apps.reviews.models import ReviewAction, TriageStatus
    from apps.reviews.services.reviews import get_cms_review, triage_review

    try:
        require_cms_access()
        review = get_cms_review(review_id)
    except PermissionDenied:
        _answer(bot, incoming, say("denied", language), alert=True)
        return "denied"
    except NotFoundError:
        # Отзыв чужого заведения управляющему не виден — как и в панели.
        _answer(bot, incoming, say("denied", language), alert=True)
        return "denied"

    hotel = Hotel.objects.get(pk=review.hotel_id)
    if review.triage_status == TriageStatus.CLOSED:
        _rewrite(bot, incoming, say("review_closed_line", language), [])
        _answer(bot, incoming, say("review_closed", language), alert=True)
        return "closed"
    if review.triage_status == TriageStatus.NEW:
        try:
            triage_review(review.pk, user=user, status=TriageStatus.IN_PROGRESS)
        except ValidationError:
            pass  # кто-то успел раньше — ниже это и будет видно
        else:
            _rewrite(bot, incoming, say("triage_by", language, name=_name(user), time=_clock(hotel, None)), [])
            _answer(bot, incoming, say("triage_ok", language))
            return "done"

    taken = (
        ReviewAction.objects.filter(review_id=review.pk, to_status=TriageStatus.IN_PROGRESS)
        .select_related("author")
        .order_by("-created_at")
        .first()
    )
    author = taken.author if taken else None
    _rewrite(
        bot,
        incoming,
        say("triage_by", language, name=_name(author), time=_clock(hotel, taken.created_at if taken else None)),
        [],
    )
    if author is not None and author.pk == user.pk:
        _answer(bot, incoming, say("triage_ok", language))
        return "already_yours"
    _answer(bot, incoming, say("already_triage", language, name=_name(author)), alert=True)
    return "already_taken"


# --- Ответ и журнал ------------------------------------------------------------------


def _rewrite(bot: Messenger, incoming: Incoming, line: str, buttons: list[Button]) -> None:
    """Дописать строку итога и оставить только переданные кнопки."""
    if not incoming.message_id:
        return
    text = incoming.message_text or ""
    subject, _, body = text.partition("\n")
    body = f"{body.rstrip()}\n\n{line}" if body.strip() else line
    try:
        bot.edit(incoming.chat_id, incoming.message_id, subject, body, buttons)
    except MessengerError as exc:
        logger.warning("Сообщение бота не переписано: %s", exc.detail)


def _answer(bot: Messenger, incoming: Incoming, text: str, *, alert: bool = False) -> None:
    try:
        bot.answer(incoming.callback_id, text, alert=alert)
    except MessengerError as exc:
        logger.warning("Ответ на нажатие не ушёл: %s", exc.detail)


def _audit(hotel_id, user, action, object_type, object_id, result, incoming: Incoming) -> None:
    """Каждое нажатие — в журнал действий отеля: кто, что, когда, чем кончилось."""
    from apps.core.context import platform_scope
    from apps.core.models import AuditLog

    with platform_scope():
        AuditLog.objects.using("platform").create(
            hotel_id=hotel_id,
            actor_type=AuditLog.ActorType.STAFF if user else AuditLog.ActorType.SYSTEM,
            actor_id=user.pk if user else None,
            action=action,
            object_type=object_type,
            object_id=object_id,
            payload={"messenger": "telegram", "result": result, "via": "telegram_button"},
        )
