from ninja import NinjaAPI

from apps.accounts.auth import CmsAuth, PlatformAuth, StaffAuth
from apps.core.errors import DomainError

from .cms import router as cms_router
from .guest import router as guest_router
from .guest_room import router as guest_room_router
from .health import router as health_router
from .chat_reviews import guest_router as surface_guest_router
from .chat_reviews import tracker_router as surface_tracker_router
from .orders import router as orders_router
from .onprem import router as onprem_router
from .platform import router as platform_router
from .staff import router as staff_router
from .tracker import router as tracker_router

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
api.add_router("/guest", guest_router)
api.add_router("/guest", surface_guest_router)
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
api.add_router("/tracker", surface_tracker_router, auth=StaffAuth())
# Весь CMS-раздел закрыт JWT персонала И РОЛЬЮ: забыть проверку на отдельном
# эндпоинте невозможно — она задана на уровне роутера. Линейный персонал сюда
# не попадает вовсе (403), управляющий попадает, но видит только свой сервис —
# это проверяет сервисный слой (apps/accounts/roles.py).
api.add_router("/cms", cms_router, auth=CmsAuth())
# Платформенная консоль на базовом домене: закрыта scope=platform токеном.
# Тенантный staff-токен сюда не пускается (и наоборот) — проверка PlatformAuth.
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


__all__ = ["api"]
