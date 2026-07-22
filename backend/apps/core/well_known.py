"""
Файлы связи сайта с нативным приложением (universal links iOS / app links
Android). Отдаются по стандартным путям в корне домена.

Пока приложения нет — отдача ВЫКЛючена конфигом (`APP_LINKS_ENABLED=False`):
эндпоинты возвращают 404, чтобы ОС не пыталась открыть несуществующее
приложение. Появится приложение — один переключатель включает ассоциации, и
печатные QR `/r/<номер>` начнут открываться в приложении без перепечатки.

Идентификаторы в конфиге — плейсхолдеры, не реальные (граница прогона).
"""

from __future__ import annotations

import json

from django.conf import settings
from django.http import Http404, HttpResponse


def _guard() -> None:
    if not getattr(settings, "APP_LINKS_ENABLED", False):
        # Ассоциации ещё не анонсированы — их не должно быть.
        raise Http404("Связь с приложением выключена")


def apple_app_site_association(request):
    """
    AASA (iOS). Content-Type строго application/json, путь БЕЗ расширения —
    так требует Apple.
    """
    _guard()
    payload = {
        "applinks": {
            "apps": [],
            "details": [
                {"appID": settings.IOS_APP_ID, "paths": ["/r/*"]},
            ],
        },
        # Место под будущие возможности — сейчас только applinks активны.
        "webcredentials": {"apps": [settings.IOS_APP_ID]},
    }
    return HttpResponse(json.dumps(payload), content_type="application/json")


def android_assetlinks(request):
    """assetlinks.json (Android App Links)."""
    _guard()
    payload = [
        {
            "relation": ["delegate_permission/common.handle_all_urls"],
            "target": {
                "namespace": "android_app",
                "package_name": settings.ANDROID_PACKAGE,
                "sha256_cert_fingerprints": list(
                    getattr(settings, "ANDROID_SHA256_FINGERPRINTS", [])
                ),
            },
        }
    ]
    return HttpResponse(json.dumps(payload), content_type="application/json")
