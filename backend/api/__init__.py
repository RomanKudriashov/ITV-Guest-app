from django.db import IntegrityError
from ninja import NinjaAPI

from apps.accounts.services.auth import CmsAuth, PlatformAuth, StaffAuth
from apps.core.db_errors import unique_conflict
from apps.core.errors import DomainError

from apps.catalog.api.router import guest_router as catalog_guest_router
from apps.accounts.api.guest.session import router as guest_session_router
from apps.accounts.api.router import staff_router
from apps.chat.api.router import guest_router as chat_guest_router
from apps.reviews.api.router import guest_router as reviews_guest_router
from apps.chat.api.router import staff_router as chat_staff_router
from apps.grms.api.router import guest_router as guest_room_router
from apps.hotels.api.router import guest_router as hotel_guest_router
from apps.orders.api.router import guest_router as orders_guest_router
from apps.orders.api.router import staff_router as orders_router
from apps.orders.api.router import tracker_router
from apps.grms.api.router import onprem_router
from apps.hotels.api.platform import router as platform_router

# Конфигурация управления номером живёт в консоли платформы. Подключается
# ЗДЕСЬ, а не внутри пакета `hotels.api.platform`: модуль GRMS берёт оттуда
# калитку прав, и встречный импорт на верхнем уровне даёт кольцо.
from apps.grms.api.platform import config_router as grms_config_router

from .cms import router as cms_router
from apps.core.api.health import router as health_router

api = NinjaAPI(
    title="ITV Guest App API",
    # Стабильный v1: маршруты под /api/v1/. Ломающие изменения — только в новой
    # мажорной версии пути (/api/v2/), политика в docs/api-versioning.md.
    version="1.0.0",
    description=(
        "Мультиотельная гостевая платформа: гостевая витрина с заказом и "
        "живым статусом, CMS-раздел «Меню», операции персонала над заказами. "
        "Все маршруты версионированы: /api/v1/. Политика — docs/api-versioning.md."
    ),
    urls_namespace="guestapp",
)

api.add_router("/health", health_router)
api.add_router("/guest", guest_session_router)
api.add_router("/guest", hotel_guest_router)
api.add_router("/guest", orders_guest_router)
# Витрина, карточка, слоты, главная и поиск — домен каталога, свой роутер.
api.add_router("/guest", catalog_guest_router)
api.add_router("/guest", chat_guest_router)
api.add_router("/guest", reviews_guest_router)
# Управление номером (GRMS). Гейт по модулю отеля и step-up по PIN — внутри
# сервисного слоя: маршрут обязан быть закрыт на СЕРВЕРЕ, а не только скрыт
# в бандле.
api.add_router("/guest", guest_room_router)
api.add_router("/staff", staff_router)
# Операции персонала над заказами: тем же JWT, что и CMS. Трекер будет
# ходить сюда же — эндпоинт писался сразу под переиспользование.
api.add_router("/orders", orders_router, auth=StaffAuth())
# Трекер: та же аутентификация, но доступ к точке проверяет сервисный слой
# — те же функции зовёт WebSocket-канал, у которого middleware нет.
api.add_router("/tracker", tracker_router, auth=StaffAuth())
api.add_router("/tracker", chat_staff_router, auth=StaffAuth())
# Весь CMS-раздел закрыт JWT персонала И РОЛЬЮ: забыть проверку на отдельном
# эндпоинте невозможно — она задана на уровне роутера. Линейный персонал сюда
# не попадает вовсе (403), управляющий попадает, но видит только свой сервис —
# это проверяет сервисный слой (apps/accounts/roles.py).
api.add_router("/cms", cms_router, auth=CmsAuth())
# Платформенная консоль на базовом домене: закрыта scope=platform токеном.
# Тенантный staff-токен сюда не пускается (и наоборот) — проверка PlatformAuth.
platform_router.add_router("", grms_config_router)
api.add_router("/platform", platform_router, auth=PlatformAuth())
# Он-прем узел отмечается сам и представляется своим ключом — не токеном
# платформы: доступ железки в отеле не должен быть частью мастер-ключа.
api.add_router("/onprem", onprem_router)


@api.exception_handler(DomainError)
def handle_domain_error(request, exc: DomainError):
    """
    Единственное место, где доменная ошибка становится HTTP-ответом.
    Сервисный слой при этом ничего не знает про HTTP.
    """
    return api.create_response(request, exc.to_response(), status=exc.status)


@api.exception_handler(IntegrityError)
def handle_integrity_error(request, exc: IntegrityError):
    """
    Нарушение уникальности — отказ, а не поломка.

    Одна точка на все ручки, включая те, которых ещё нет: уникальные индексы
    не знают про `deleted_at`, и «удалить и завести заново» иначе отвечает
    пятисоткой, то есть «сломалась платформа» вместо «занято».

    Всё остальное — внешние ключи, NOT NULL, проверочные ограничения —
    пробрасывается дальше и остаётся ошибкой сервера. Это дефекты кода, и
    вежливый 409 их бы просто спрятал.
    """
    conflict = unique_conflict(exc, request)
    if conflict is None:
        raise exc
    return api.create_response(request, conflict, status=409)


__all__ = ["api"]
