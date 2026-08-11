from django.urls import path

from apps.grms.consumers import ConnectorConsumer

from .consumers import (
    GuestChatConsumer,
    GuestOrderConsumer,
    RoomStateConsumer,
    StaffChatConsumer,
    TrackerConsumer,
)

# Каналы описываем один раз БЕЗ префикса ws/ — а затем публикуем под
# версионированным `ws/v1/` и, на переходный период, под безверсионным `ws/`
# алиасом. Один консюмер на оба адреса: логика не раздваивается.
# РАЗДЕЛЕНИЕ ПО СПОСОБУ АУТЕНТИФИКАЦИИ, а не по домену.
#
# Браузерные каналы приходят со страницы, и у них есть `Origin` — его проверяет
# `AllowedHostsOriginValidator` в config/asgi.py. Он-прем канал приходит от
# коробки на сервере отеля: это не браузер, `Origin` он не шлёт и слать не
# должен, а представляется КЛЮЧОМ УЗЛА. Проверять у него происхождение
# страницы нечего — страницы нет.
#
# Списки лежат рядом, чтобы исключение нельзя было забыть обновить: маршрут
# попадает ровно в один из них, и третьего места нет.
_BROWSER_ROUTES = [
    # Точка задаётся кодом, а не UUID: код стабилен, читается в логах и его
    # удобно держать в адресе на планшете кухни.
    ("tracker/<slug:point_code>/", TrackerConsumer),
    ("guest/order/<uuid:order_id>/", GuestOrderConsumer),
    ("guest/chat/", GuestChatConsumer),
    # Комнаты в адресе нет намеренно: она резолвится из токена сессии, как и
    # тред чата. Прислать чужой номер этому каналу нечем.
    ("guest/room/", RoomStateConsumer),
    ("staff/chat/<uuid:thread_id>/", StaffChatConsumer),
]

_ONPREM_ROUTES = [
    # Он-прем узел. Без слеша на конце: адрес зашит в конфиг коробки на
    # объекте, и лишний слеш там стоил бы выезда инженера.
    ("onprem/connector", ConnectorConsumer),
]

def _published(routes):
    """Каждый маршрут — под версионированным адресом и безверсионным алиасом."""
    return [
        path(f"ws/{prefix}{suffix}", consumer.as_asgi())
        for prefix in ("v1/", "")
        for suffix, consumer in routes
    ]


browser_urlpatterns = _published(_BROWSER_ROUTES)

# Старый путь. Оставлен, чтобы старые вкладки не отваливались при выкатке;
# убрать после того, как клиенты перейдут на /ws/v1/guest/.
browser_urlpatterns.append(
    path("ws/order/<uuid:order_id>/", GuestOrderConsumer.as_asgi())
)

onprem_urlpatterns = _published(_ONPREM_ROUTES)

# Полный список — для тех, кому нужны ВСЕ адреса разом (сторож карты адресов).
# Проверку источника он не описывает: её расставляет config/asgi.py.
websocket_urlpatterns = browser_urlpatterns + onprem_urlpatterns

# Литеральные адреса он-прем канала — по ним `config/asgi.py` решает, кому не
# проверять источник. Считаются ИЗ ТОГО ЖЕ списка, а не выписаны второй раз:
# разъехаться нечему. Параметров в этих адресах нет и быть не должно — узел
# представляется ключом, а не тем, что написано в пути.
ONPREM_PATHS = frozenset(
    f"/ws/{prefix}{suffix}" for prefix in ("v1/", "") for suffix, _ in _ONPREM_ROUTES
)


def is_onprem_path(path: str) -> bool:
    """Он-прем ли это канал. Пустой хвостовой слеш адресу узла не прощаем."""
    return path in ONPREM_PATHS
