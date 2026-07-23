from django.urls import path

from .consumers import (
    GuestChatConsumer,
    GuestOrderConsumer,
    StaffChatConsumer,
    TrackerConsumer,
)

# Каналы описываем один раз БЕЗ префикса ws/ — а затем публикуем под
# версионированным `ws/v1/` и, на переходный период, под безверсионным `ws/`
# алиасом. Один консюмер на оба адреса: логика не раздваивается.
_WS_ROUTES = [
    # Точка задаётся кодом, а не UUID: код стабилен, читается в логах и его
    # удобно держать в адресе на планшете кухни.
    ("tracker/<slug:point_code>/", TrackerConsumer),
    ("guest/order/<uuid:order_id>/", GuestOrderConsumer),
    ("guest/chat/", GuestChatConsumer),
    ("staff/chat/<uuid:thread_id>/", StaffChatConsumer),
]

websocket_urlpatterns = [
    path(f"ws/{prefix}{suffix}", consumer.as_asgi())
    for prefix in ("v1/", "")
    for suffix, consumer in _WS_ROUTES
]

# Старый путь. Оставлен, чтобы старые вкладки не отваливались
# при выкатке; убрать после того, как клиенты перейдут на /ws/v1/guest/.
websocket_urlpatterns.append(
    path("ws/order/<uuid:order_id>/", GuestOrderConsumer.as_asgi())
)
