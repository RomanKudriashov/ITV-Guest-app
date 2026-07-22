from django.urls import path

from api import api
from apps.core.well_known import android_assetlinks, apple_app_site_association

urlpatterns = [
    # Файлы связи с приложением — в корне домена, по стандартным путям.
    # AASA намеренно без расширения (требование Apple).
    path(".well-known/apple-app-site-association", apple_app_site_association),
    path(".well-known/assetlinks.json", android_assetlinks),
    # Прикладной API смонтирован ТОЛЬКО под /api/v1/. Безверсионные пути
    # /api/... переписывает в v1 ApiVersionMiddleware (алиас на переходный
    # период), поэтому второго монтирования не нужно.
    path("api/v1/", api.urls),
]
