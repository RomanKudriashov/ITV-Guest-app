import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

# HTTP-приложение поднимаем до импорта consumers: они тянут модели.
django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402
from channels.security.websocket import AllowedHostsOriginValidator  # noqa: E402

from apps.realtime.routing import (  # noqa: E402
    browser_urlpatterns,
    is_onprem_path,
    onprem_urlpatterns,
)

# ПРОВЕРКА ИСТОЧНИКА — НЕ ДЛЯ ОН-ПРЕМ КАНАЛА.
#
# `AllowedHostsOriginValidator` защищает от того, что ЧУЖАЯ СТРАНИЦА откроет
# сокет от имени пользователя, у которого в браузере живая сессия. Защита
# осмысленна ровно там, где на другом конце браузер: гость, персонал, трекер.
# Они остаются под ней.
#
# У он-прем канала браузера нет. На другом конце коробка на сервере отеля: она
# не шлёт `Origin`, потому что его неоткуда взять, и представляется КЛЮЧОМ
# УЗЛА — секретом, которого проверка происхождения не заменяет и не усиливает.
#
# Пока валидатор стоял на всех сокетах, коннектор получал 403 ДО проверки
# ключа. Локально это было не видно: при `DEBUG=1` Django кладёт в
# `ALLOWED_HOSTS` звёздочку, и валидатор пропускает всё. Расхождение вылезло
# только на стенде с `DEBUG=0`, и выглядело как «управление номером
# недоступно» без внятной причины.
#
# Исключение ТОЧЕЧНОЕ: изъят один маршрут, а не снята защита. Разделение живёт
# в `apps/realtime/routing.py`, где маршрут попадает ровно в один из двух
# списков, а адреса исключения считаются из того же списка — выписать их
# второй раз и разъехаться нечему.
_onprem = URLRouter(onprem_urlpatterns)
_browser = AllowedHostsOriginValidator(URLRouter(browser_urlpatterns))


async def websocket_router(scope, receive, send):
    """Он-прем — мимо проверки источника, всё остальное — через неё."""
    handler = _onprem if is_onprem_path(scope.get("path", "")) else _browser
    return await handler(scope, receive, send)


application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": websocket_router,
    }
)
