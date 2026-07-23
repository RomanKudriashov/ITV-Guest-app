"""
Фаза S: версионирование маршрутов и схема deep-link.

Инвариант переезда: и /api/v1/..., и безверсионный алиас /api/... отвечают
одинаково; версия — в заголовке; алиас помечен устаревшим. Плюс отдача файлов
связи с приложением (за конфигом) и формирование deep-link.
"""

from __future__ import annotations

import json

import pytest

from .conftest import host_for

pytestmark = pytest.mark.django_db


def _session(client, hotel, room="305"):
    return client.post(
        path_for_session(),
        data={"room_number": room},
        content_type="application/json",
        HTTP_HOST=host_for(hotel),
    )


def path_for_session():
    return "/api/v1/guest/session"


# --- Версионирование -------------------------------------------------------


def test_versioned_and_legacy_paths_both_work(client, crystal):
    v1 = client.post(
        "/api/v1/guest/session", data={"room_number": "305"},
        content_type="application/json", HTTP_HOST=host_for(crystal),
    )
    legacy = client.post(
        "/api/guest/session", data={"room_number": "305"},
        content_type="application/json", HTTP_HOST=host_for(crystal),
    )
    assert v1.status_code == 200, v1.content
    assert legacy.status_code == 200, legacy.content
    # Одинаковая форма ответа — переезд, не редизайн.
    assert set(v1.json()) == set(legacy.json())


def test_version_header_on_both(client, crystal):
    v1 = _session(client, crystal)
    legacy = client.post(
        "/api/guest/session", data={"room_number": "305"},
        content_type="application/json", HTTP_HOST=host_for(crystal),
    )
    assert v1["X-API-Version"] == "v1"
    assert legacy["X-API-Version"] == "v1"


def test_legacy_alias_is_marked_deprecated(client, crystal):
    legacy = client.post(
        "/api/guest/session", data={"room_number": "305"},
        content_type="application/json", HTTP_HOST=host_for(crystal),
    )
    v1 = _session(client, crystal)
    assert legacy["Deprecation"] == "true"
    assert 'rel="successor-version"' in legacy["Link"]
    # Версионированный путь устаревшим НЕ помечается.
    assert not v1.has_header("Deprecation")


def test_health_on_both_paths(client):
    # health платформенный — тенант не нужен; проверяем оба адреса.
    assert client.get("/api/v1/health").status_code == 200
    assert client.get("/api/health").status_code == 200


# --- Файлы связи с приложением ---------------------------------------------


def test_app_links_disabled_by_default(client, crystal, settings):
    settings.APP_LINKS_ENABLED = False
    aasa = client.get("/.well-known/apple-app-site-association", HTTP_HOST=host_for(crystal))
    android = client.get("/.well-known/assetlinks.json", HTTP_HOST=host_for(crystal))
    assert aasa.status_code == 404
    assert android.status_code == 404


def test_aasa_served_when_enabled(client, crystal, settings):
    settings.APP_LINKS_ENABLED = True
    resp = client.get("/.well-known/apple-app-site-association", HTTP_HOST=host_for(crystal))
    assert resp.status_code == 200
    # Content-Type строго application/json, путь без расширения.
    assert resp["Content-Type"] == "application/json"
    body = json.loads(resp.content)
    assert body["applinks"]["details"][0]["appID"] == settings.IOS_APP_ID
    assert body["applinks"]["details"][0]["paths"] == ["/r/*"]


def test_assetlinks_served_when_enabled(client, crystal, settings):
    settings.APP_LINKS_ENABLED = True
    resp = client.get("/.well-known/assetlinks.json", HTTP_HOST=host_for(crystal))
    assert resp.status_code == 200
    assert resp["Content-Type"] == "application/json"
    body = json.loads(resp.content)
    assert body[0]["target"]["namespace"] == "android_app"
    assert body[0]["target"]["package_name"] == settings.ANDROID_PACKAGE


# --- Deep-link -------------------------------------------------------------


def test_room_deeplink_is_canonical(crystal):
    url = crystal.room_deeplink("305")
    assert url.endswith("/r/305")
    assert crystal.subdomain in url

    with_params = crystal.room_deeplink("305", lang="ru", source="qr", token="abc")
    assert "/r/305?" in with_params
    assert "lang=ru" in with_params
    assert "src=qr" in with_params
    assert "t=abc" in with_params


def test_deeplink_valid_and_session_fallback_for_unknown_room(client, crystal):
    # Ссылка строится даже для несуществующего номера — QR не «протухает».
    assert crystal.room_deeplink("999").endswith("/r/999")

    # Вход по несуществующему номеру — аккуратный фолбэк на ручной ввод.
    resp = client.post(
        "/api/v1/guest/session", data={"room_number": "999"},
        content_type="application/json", HTTP_HOST=host_for(crystal),
    )
    assert resp.status_code == 404
    body = resp.json()
    assert body["code"] == "room_not_found"
    assert body["hint"] == "manual_entry"


def test_qr_matrix_uses_deeplink(cms, crystal):
    # Матрица номеров строит ссылки через ту же функцию: guest_url = .../r/<номер>.
    resp = cms.get("/api/v1/cms/rooms")
    assert resp.status_code == 200, resp.content
    rooms = resp.json()
    row = next(r for r in rooms if r.get("guest_url"))
    assert f"/r/{row['number']}" in row["guest_url"]
