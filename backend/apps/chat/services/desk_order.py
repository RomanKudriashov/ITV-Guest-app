"""
Заказ от имени гостя — с рабочего места ресепшена, прямо из диалога.

Ресепшен собирает корзину за гостя тем же каталогом и теми же правилами, что
гость: матрица мест, самовывоз, коммерция заведения, доступность. Отличается
только одно — кто оформил.

КУДА ЛОЖИТСЯ ЗАКАЗ.
  * Сессия гостя из диалога жива → заказ в ЕГО сессии: гость видит его в своём
    списке (с пометкой «оформил ресепшен») и следит за статусом вживую.
  * Сессии нет (выехал, или диалог без живой сессии) → заказ только на номер
    диалога: у гостя в телефоне его не будет, на доске — будет.
  * Ни сессии, ни номера → оформлять некуда: 422 `no_guest_target`.

ОПЛАТУ НЕ ТРОГАЕМ — её в системе нет. Чаевых ресепшен не ставит.
"""

from __future__ import annotations

from django.utils import timezone

from apps.core.errors import ValidationError


def venues(language: str) -> list[dict]:
    """Заведения, из которых можно заказать: те же, что у гостя на витрине."""
    from apps.catalog.services.showcase import _venues
    from apps.core.fields import translate
    from apps.hotels.services.hotel import current_hotel

    result = []
    for service in _venues(current_hotel()):
        result.append(
            {
                "code": service.code,
                "point": service.execution_point.code,
                "title": translate(service.public_name, language) or service.code,
                "type": service.type,
            }
        )
    return result


def catalog(language: str, *, point: str, offering_type: str) -> dict:
    from apps.catalog.services.menu import MenuOptions, build_menu
    from apps.hotels.services.hotel import current_hotel

    return build_menu(
        MenuOptions(
            language=language,
            include_unavailable=True,
            offering_type=offering_type,
            point_code=point,
        ),
        hotel=current_hotel(),
    )


def live_session(thread):
    session = thread.guest_session
    if session is None or session.revoked_at is not None or session.expires_at <= timezone.now():
        return None
    return session


def room_number(thread) -> str | None:
    if thread.room_id:
        return thread.room.number
    session = live_session(thread)
    return session.room.number if session is not None and session.room_id else None


def place(thread, data, *, user):
    """Оформить. `data` — тот же OrderInput, что у гостя, без чаевых."""
    from apps.orders.services import create_order

    session = live_session(thread)
    room_id = thread.room_id or (session.room_id if session is not None else None)
    if session is None and room_id is None:
        raise ValidationError(
            "У диалога нет ни живой сессии гостя, ни номера — оформлять некуда",
            code="no_guest_target",
        )
    data.room_id = str(room_id) if room_id else None
    data.tip_minor = None
    data.tip_percent = None
    return create_order(data, guest_session=session, placed_by=user)


def announce(thread, order, *, user, language: str) -> None:
    """
    Сообщение гостю в диалог: «Оформили для вас заказ №…». Гость видит, что
    заказ сделан по его просьбе, — а не находит чужой заказ у себя в списке.
    Только живой сессии: писать уехавшему некуда.
    """
    from apps.chat.services.threads import staff_send
    from apps.orders.services.services import _order_summary

    if live_session(thread) is None:
        return
    summary = _order_summary(order, language).get("summary") or ""
    body = f"Оформили для вас заказ №{order.number}" + (f": {summary}" if summary else "")
    staff_send(thread, user, body)
