"""
Экспорт и офбординг данных отеля (152-ФЗ).

Две разные операции, которые легко спутать, а спутать нельзя:

**Экспорт** — отдать отелю его данные. Обратим, ничего не меняет, делается
сколько угодно раз. Это право отеля, а не одолжение платформы.

**Офбординг** — прекратить обработку. Необратим. Поэтому здесь он разложен на
ДВА шага: сначала отель отключается и помечается к удалению, и только потом,
отдельным подтверждённым действием, данные стираются. Одношаговое «удалить
отель» рано или поздно нажимают не на той строке.

Что стирается и что нет. Стираются персональные данные и содержимое отеля.
Остаётся строка отеля с поддоменом и запись в журнале: платформа обязана уметь
ответить, что такой отель был и когда его данные удалены, — и это тоже
требование закона, а не наша забывчивость.
"""

from __future__ import annotations

import json
from datetime import date

from django.db import transaction
from django.utils import timezone

from apps.core.context import tenant_context
from apps.core.errors import ValidationError
from apps.hotels.models import Hotel

# Настройки офбординга живут в settings отеля: отдельная таблица ради двух
# полей на редкую операцию — лишняя сущность.
_MARK_KEY = "offboarding"

# Сколько последних заказов попадает в выгрузку.
ORDERS_LIMIT = 5000


def export_hotel(hotel: Hotel) -> dict:
    """
    Полная выгрузка отеля в JSON-совместимую структуру.

    Собирается по НАЗВАННЫМ разделам, а не обходом всех моделей: обход тащил бы
    и служебные таблицы, и токены сессий, и хэши паролей. Отелю нужны его
    данные, а не наша схема.
    """
    from apps.accounts.models import User
    from apps.catalog.models import Category, Item
    from apps.hotels.models import HotelLanguage, Room, Service
    from apps.orders.models import Order

    with tenant_context(hotel):
        languages = list(HotelLanguage.objects.values("code", "title", "is_default", "sort_order"))
        rooms = list(Room.objects.values("number", "floor", "zone", "is_active"))
        services = list(
            Service.objects.values("code", "type", "public_name", "tagline", "is_active", "is_guest_facing")
        )
        categories = list(Category.objects.values("code", "type", "title", "is_active", "sort_order"))
        items = list(
            Item.objects.values("code", "type", "title", "description", "price", "is_active")
        )
        staff = list(
            User.objects.filter(is_staff_member=True).values("email", "full_name", "is_hotel_admin")
        )
        # Заказы — срезом: полная история отеля может быть огромной, а выгрузка
        # обязана дойти до конца. Ограничение названо явно в ответе, а не
        # молча обрезает данные.
        orders = list(
            Order.objects.order_by("-created_at").values(
                "number", "created_at", "type", "total", "currency", "subtotal_minor"
            )[:ORDERS_LIMIT]
        )
        orders_total = Order.objects.count()

    return {
        "exported_at": timezone.now().isoformat(),
        "hotel": {
            "name": hotel.name,
            "subdomain": hotel.subdomain,
            "timezone": hotel.timezone,
            "currency": hotel.currency,
            "tariff": hotel.tariff,
            "created_at": hotel.created_at.isoformat(),
        },
        "languages": languages,
        "rooms": rooms,
        "services": services,
        "categories": categories,
        "items": items,
        # Персонал отдаём без паролей и токенов: выгрузка не должна быть
        # способом получить доступ к чужим учёткам.
        "staff": staff,
        "orders": orders,
        "orders_meta": {"included": len(orders), "total": orders_total, "limit": ORDERS_LIMIT},
    }


def export_json(hotel: Hotel) -> str:
    return json.dumps(export_hotel(hotel), ensure_ascii=False, indent=2, default=str)


def mark_for_offboarding(hotel: Hotel, *, reason: str, actor_id) -> dict:
    """
    Шаг 1: отель отключается и помечается к удалению. Обратимо.

    Отключение здесь не косметика: пока отель помечен, его витрина и CMS не
    должны работать — иначе гость сделает заказ в отеле, который уже уходит.
    """
    reason = (reason or "").strip()
    if not reason:
        raise ValidationError("Укажите причину офбординга", field="reason")

    settings = dict(hotel.settings or {})
    settings[_MARK_KEY] = {
        "marked_at": timezone.now().isoformat(),
        "marked_by": str(actor_id),
        "reason": reason,
    }
    hotel.settings = settings
    hotel.is_active = False
    hotel.save(update_fields=["settings", "is_active", "updated_at"])
    return settings[_MARK_KEY]


def unmark(hotel: Hotel) -> None:
    """Передумали. Отключённым отель остаётся — включают его отдельно и осознанно."""
    settings = dict(hotel.settings or {})
    settings.pop(_MARK_KEY, None)
    hotel.settings = settings
    hotel.save(update_fields=["settings", "updated_at"])


def offboarding_state(hotel: Hotel) -> dict | None:
    return (hotel.settings or {}).get(_MARK_KEY)


@transaction.atomic
def purge_hotel(hotel: Hotel, *, confirm_subdomain: str, actor_id) -> dict:
    """
    Шаг 2: необратимое удаление данных отеля.

    Требует, чтобы человек ВВЁЛ поддомен: подтверждение галочкой ставят не
    глядя, а имя удаляемого набирают, только посмотрев на него. И требует
    предварительной пометки — «удалить» не должно быть доступно одним движением
    из списка.
    """
    if offboarding_state(hotel) is None:
        raise ValidationError(
            "Сначала пометьте отель к офбордингу — удаление идёт вторым шагом",
            code="not_marked",
        )
    if (confirm_subdomain or "").strip().lower() != hotel.subdomain:
        raise ValidationError(
            "Поддомен введён неверно — данные не удалены",
            field="confirm_subdomain",
            code="confirm_mismatch",
        )

    from apps.accounts.models import GuestSession, User
    from apps.catalog.models import Category, Item
    from apps.chat.models import ChatMessage, ChatThread
    from apps.hotels.models import ExecutionPoint, HotelLanguage, OnPremNode, Room, Service
    from apps.media.models import MediaAsset
    from apps.orders.models import Order
    from apps.reviews.models import Review

    removed: dict[str, int] = {}
    with tenant_context(hotel):
        # ЖЁСТКОЕ удаление, а не мягкое. Во всём остальном проекте `delete()`
        # проставляет `deleted_at` — и это правильно: удалённое блюдо должно
        # оставаться в истории заказов. Но офбординг по 152-ФЗ означает
        # «данных больше нет», а мягко удалённая строка — это данные, просто
        # спрятанные от интерфейса. Здесь единственное место, где нужен
        # `hard_delete()`.
        #
        # Порядок важен: сначала то, что ссылается, потом то, на что ссылаются.
        for label, queryset in (
            ("reviews", Review.all_objects.all()),
            ("chat_messages", ChatMessage.all_objects.all()),
            ("chat_threads", ChatThread.all_objects.all()),
            ("orders", Order.all_objects.all()),
            ("guest_sessions", GuestSession.all_objects.all()),
            ("items", Item.all_objects.all()),
            ("categories", Category.all_objects.all()),
            ("services", Service.all_objects.all()),
            ("nodes", OnPremNode.all_objects.all()),
            ("execution_points", ExecutionPoint.all_objects.all()),
            ("rooms", Room.all_objects.all()),
            ("media", MediaAsset.all_objects.all()),
            ("languages", HotelLanguage.all_objects.all()),
            ("staff", User.objects.filter(is_staff_member=True)),
        ):
            deleted, _ = queryset.hard_delete()
            removed[label] = deleted

    # Строку отеля НЕ удаляем: платформа обязана уметь ответить, что такой
    # отель был и когда его данные стёрты. Оставляем поддомен, дату и отметку.
    settings = dict(hotel.settings or {})
    settings[_MARK_KEY] = {
        **(settings.get(_MARK_KEY) or {}),
        "purged_at": timezone.now().isoformat(),
        "purged_by": str(actor_id),
        "removed": removed,
    }
    hotel.settings = settings
    hotel.is_active = False
    hotel.save(update_fields=["settings", "is_active", "updated_at"])
    return {"removed": removed, "purged_on": str(date.today())}
