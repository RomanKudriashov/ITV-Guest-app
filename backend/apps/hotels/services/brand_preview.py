"""
ПОКАЗ ВИТРИНЫ ДЛЯ НАСТРОЙКИ ОФОРМЛЕНИЯ.

Оператор подбирает цвета, шрифты и логотип, глядя на экраны гостя. До этой
партии показ собирался НА КЛИЕНТЕ из четырёх компонентов и трёх выдуманных
блюд: любая новая полоса на настоящей главной в него не попадала, а отличить
выдумку от своего каталога было нечем.

ПОЧЕМУ РУЧКА, А НЕ ГОСТЕВАЯ СЕССИЯ ИЗ ПАНЕЛИ. Витрина требует сессию даже в
режиме «просто посмотреть»: `submit(null)` всё равно заводит её на сервере.
Открывать сессию каждый раз, когда оператор зашёл в оформление, значит плодить
гостей, которых не было, и делать показ участником гостевого потока — с его
счётчиками, чатом и историей. Ручка честнее: данные те же, права — оператора,
следов в гостевом потоке нет.

ОДИН СБОРЩИК НА ВИТРИНУ И НА ПОКАЗ. Здесь не собирается НИ ОДНОГО значения:
всё, что отдаётся, считают те же функции, что отвечают гостю
(`home_payload`, `build_menu`, `list_venues`, `get_item_detail`,
`locations_payload`, `build_state`). Разойтись показу и витрине физически негде
— а именно этим они и занимались.

ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ. Чата нет: без живого гостя это пустой тред, а чужую
переписку на экране настройки показывать нельзя (решение 11 в журнале). Сессии,
корзины и заказа нет: они принадлежат конкретному гостю, и показывать их у
оператора значило бы выдумывать человека.
"""

from __future__ import annotations

from apps.accounts.services.roles import require_cms_access
from apps.core.errors import ValidationError


SCREENS = ("home", "venues", "catalog", "item", "locations", "room")


def preview_payload(
    hotel,
    *,
    screen: str,
    language: str,
    group: str = "",
    point: str = "",
    offering_type: str = "product",
    item_id: str = "",
    room_number: str = "",
) -> dict:
    """
    Данные одного экрана показа — ровно в той форме, в какой их получает гость.

    Форму держим ту же не ради экономии: показ рисуется НАСТОЯЩИМИ компонентами
    витрины, и любое расхождение формы означало бы, что показывают не то, что
    увидит гость.
    """
    require_cms_access()

    if screen not in SCREENS:
        raise ValidationError(
            f"Неизвестный экран показа «{screen}». Ожидается один из: "
            + ", ".join(SCREENS),
            field="screen",
            code="unknown_screen",
        )

    if screen == "home":
        from apps.catalog.services.home import home_payload

        # Номера нет и непрочитанных нет: оператор смотрит глазами гостя,
        # который ещё не представился. Это настоящее состояние витрины, а не
        # выдуманное — ровно так её видит зашедший «просто посмотреть».
        return home_payload(hotel, language=language, room=None, unread_chat=0)

    if screen == "venues":
        from apps.catalog.services.showcase import list_venues

        return {"venues": list_venues(hotel, group or "restaurants", language=language, moment=hotel.local_now())}

    if screen == "catalog":
        from apps.catalog.services.menu import MenuOptions, build_menu

        return build_menu(
            MenuOptions(
                language=language,
                include_unavailable=True,
                offering_type=offering_type,
                point_code=point or None,
            ),
            hotel=hotel,
        )

    if screen == "item":
        from apps.catalog.services.menu import get_item_detail

        if not item_id:
            item_id = _first_item_id(hotel, offering_type)
        if not item_id:
            return {}
        return get_item_detail(item_id, language=language)

    if screen == "locations":
        from apps.hotels.services.locations import locations_payload

        # `has_room=False` — тот же гость без номера, что и на главной.
        return locations_payload(language=language, has_room=False)

    # room
    from apps.grms.services import guest as room_guest

    room = _room_for_preview(hotel, room_number)
    if room is None:
        # Управляемых номеров у отеля нет — это и есть честный ответ: экран
        # покажет своё «недоступно», а не выдуманные лампы.
        return room_guest.build_state(hotel, None, language=language)
    return room_guest.build_state(hotel, None, language=language, room_id=room.pk)


def _first_item_id(hotel, offering_type: str) -> str:
    """Первая позиция каталога — чтобы показ карточки не требовал выбора."""
    from apps.catalog.models import Item

    item = (
        Item.objects.filter(type=offering_type, is_active=True)
        .order_by("sort_order", "code")
        .first()
    )
    return str(item.pk) if item else ""


def _room_for_preview(hotel, room_number: str):
    """
    Номер для показа: названный оператором или первый УПРАВЛЯЕМЫЙ.

    Первый попавшийся номер не годится: у отеля их сотни, а привязан к типу
    управления далеко не каждый. Показ, взявший неуправляемый номер, показал бы
    «недоступно» там, где у отеля всё работает.
    """
    from apps.grms.models import RoomTypeRoom

    query = RoomTypeRoom.objects.select_related("room")
    if room_number:
        query = query.filter(room__number=room_number)
    link = query.order_by("room__number").first()
    return link.room if link else None
