from ninja import NinjaAPI

from apps.accounts.auth import StaffAuth
from apps.core.errors import DomainError

from .cms import router as cms_router
from .guest import router as guest_router
from .health import router as health_router
from .chat_reviews import guest_router as surface_guest_router
from .chat_reviews import tracker_router as surface_tracker_router
from .orders import router as orders_router
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
api.add_router("/staff", staff_router)
# Операции персонала над заказами: тем же JWT, что и CMS. Трекер будет
# ходить сюда же — эндпоинт писался сразу под переиспользование.
api.add_router("/orders", orders_router, auth=StaffAuth())
# Трекер: та же аутентификация, но доступ к точке проверяет сервисный слой
# — те же функции зовёт WebSocket-канал, у которого middleware нет.
api.add_router("/tracker", tracker_router, auth=StaffAuth())
api.add_router("/tracker", surface_tracker_router, auth=StaffAuth())
# Весь CMS-раздел закрыт JWT персонала по умолчанию: забыть auth на отдельном
# эндпоинте невозможно — он задан на уровне роутера.
api.add_router("/cms", cms_router, auth=StaffAuth())


@api.exception_handler(DomainError)
def handle_domain_error(request, exc: DomainError):
    """
    Единственное место, где доменная ошибка становится HTTP-ответом.
    Сервисный слой при этом ничего не знает про HTTP.
    """
    return api.create_response(request, exc.to_response(), status=exc.status)


__all__ = ["api"]
