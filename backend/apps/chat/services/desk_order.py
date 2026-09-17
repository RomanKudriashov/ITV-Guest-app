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


# --- Задача в отдел ------------------------------------------------------------

ERRAND_CATEGORY_CODE = "internal-errand"
ERRAND_ITEM_CODE = "errand"
ERRAND_TITLE = {"ru": "Поручение", "en": "Errand", "ar": "مهمة", "zh": "任务"}


def errand_item(point):
    """
    Служебная позиция отдела — «Поручение». Заводится при первой передаче и
    живёт дальше: заказ из неё идёт по доске отдела как обычная задача, со
    статусами, просрочкой и эскалацией. Гостю она не видна нигде.
    """
    from apps.catalog.models import Category, Item, Route
    from apps.catalog.offerings import LocationMode, OfferingType

    service = point.services.first()
    category = _revive_or_create(
        Category,
        code=f"{ERRAND_CATEGORY_CODE}-{point.code}",
        defaults={
            "type": OfferingType.SERVICE_REQUEST,
            "title": ERRAND_TITLE,
            "service": service,
            "is_internal": True,
        },
    )
    Route.objects.get_or_create(category=category, execution_point=point, defaults={"priority": 0})
    return _revive_or_create(
        Item,
        code=f"{ERRAND_ITEM_CODE}-{point.code}",
        defaults={
            "category": category,
            "type": OfferingType.SERVICE_REQUEST,
            "title": ERRAND_TITLE,
            "price": None,
            "location_mode": LocationMode.ROOM,
            "is_internal": True,
        },
    )


def _revive_or_create(model, *, code: str, defaults: dict):
    """
    Найти живую, поднять мягко удалённую, иначе завести.

    Код занят и удалённой строкой (уникальность в базе её видит): служебную
    позицию мог унести кто угодно — уборка стенда, чужая правка каталога, — и
    передача задачи не должна из-за этого отказывать. Поднимаем ту же строку,
    а не заводим вторую с чужим кодом.
    """
    existing = model.all_objects.filter(code=code).first()
    if existing is None:
        return model.objects.create(code=code, **defaults)
    changed = []
    if existing.deleted_at is not None:
        existing.deleted_at = None
        changed.append("deleted_at")
    if not existing.is_active:
        existing.is_active = True
        changed.append("is_active")
    if changed:
        model.all_objects.filter(pk=existing.pk).update(**{f: getattr(existing, f) for f in changed})
    return existing


def task_points(language: str) -> list[dict]:
    """Отделы, которым можно передать задачу: все живые исполнители отеля."""
    from apps.core.fields import translate
    from apps.hotels.models import ExecutionPoint

    from apps.chat.services.threads import reception_point

    desk = reception_point()
    points = ExecutionPoint.objects.filter(is_active=True).order_by("code")
    return [
        {
            "code": point.code,
            "title": translate(point.title, language) or point.code,
            "public_title": _public_title(point, language),
        }
        for point in points
        if desk is None or point.pk != desk.pk
    ]


def _public_title(point, language: str) -> str:
    from apps.core.fields import translate

    service = point.services.first()
    if service is not None:
        return translate(service.public_name, language) or translate(point.title, language) or point.code
    return translate(point.title, language) or point.code


def hand_over(thread, *, point_code: str, text: str, user, language: str):
    """
    Передать задачу отделу. ПЕРЕПИСКА ОСТАЁТСЯ У РЕСЕПШЕНА: отдел получает
    задачу на свою доску, а не диалог с гостем.
    """
    from apps.core.errors import ValidationError
    from apps.hotels.models import ExecutionPoint
    from apps.orders.services import OrderInput, OrderLineInput, create_order

    text = (text or "").strip()
    if not text:
        raise ValidationError("Напишите, что сделать", field="text", code="empty_task")
    point = ExecutionPoint.objects.filter(code=point_code, is_active=True).first()
    if point is None:
        raise ValidationError("Отдел не найден", field="point", code="point_not_found")

    session = live_session(thread)
    room_id = thread.room_id or (session.room_id if session is not None else None)
    item = errand_item(point)
    order = create_order(
        OrderInput(
            lines=[OrderLineInput(item_id=str(item.pk))],
            room_id=str(room_id) if room_id else None,
            comment=text[:500],
            timing="asap",
        ),
        placed_by=user,
    )
    order.source_thread = thread
    order.save(update_fields=["source_thread", "updated_at"])
    return order, _public_title(point, language)


def announce_task(thread, *, title: str, user) -> None:
    """Гостю — по-человечески: «передали в хозслужбу», без слова «заказ»."""
    from apps.chat.services.threads import staff_send

    if live_session(thread) is None:
        return
    staff_send(thread, user, f"Передали в «{title}» — сообщим, как будет сделано")
