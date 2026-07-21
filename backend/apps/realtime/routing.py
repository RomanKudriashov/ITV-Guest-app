from django.urls import path

from .consumers import GuestOrderConsumer, TrackerConsumer

websocket_urlpatterns = [
    # Точка задаётся кодом, а не UUID: код стабилен, читается в логах и его
    # удобно держать в адресе на планшете кухни.
    path("ws/tracker/<slug:point_code>/", TrackerConsumer.as_asgi()),
    path("ws/guest/order/<uuid:order_id>/", GuestOrderConsumer.as_asgi()),
    # Путь из первого прогона. Оставлен, чтобы старые вкладки не отваливались
    # при выкатке; убрать после того, как клиенты перейдут на /ws/guest/.
    path("ws/order/<uuid:order_id>/", GuestOrderConsumer.as_asgi()),
]
