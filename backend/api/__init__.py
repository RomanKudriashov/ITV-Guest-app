from ninja import NinjaAPI

from .guest import router as guest_router
from .health import router as health_router

api = NinjaAPI(
    title="ITV Guest App API",
    version="0.1.0",
    description=(
        "Фундамент мультиотельной гостевой платформы. В этом прогоне открыты "
        "только дымовые гостевые эндпоинты."
    ),
    urls_namespace="guestapp",
)

api.add_router("/health", health_router)
api.add_router("/guest", guest_router)

__all__ = ["api"]
