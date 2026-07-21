from django.urls import path

from .consumers import GuestOrderConsumer, TrackerConsumer

websocket_urlpatterns = [
    path("ws/tracker/", TrackerConsumer.as_asgi()),
    path("ws/order/<uuid:order_id>/", GuestOrderConsumer.as_asgi()),
]
