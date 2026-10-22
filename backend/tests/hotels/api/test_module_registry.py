"""
Реестр модулей отеля (R1): платформа настраивает, отель читает.

Контракта у механизма нет: ссылка отсюда годами вела в несуществующий файл.
Механизм описания заслуживает — выключенный модуль закрывает целый раздел CMS
ответом `403 module_disabled`, — но это отдельная работа. Очередь и правило,
по которому решают, писать ли контракт вообще: docs/api-contracts.md.
"""

from __future__ import annotations

import json

import pytest

from apps.hotels.models import HotelModule
from apps.hotels.services.provisioning import ensure_platform_admin

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

BASE_HOST = "guest.localhost"
ALL_CODES = {code.value for code in HotelModule.Code}


@pytest.fixture
def platform_token(client):
    ensure_platform_admin(email="root@platform.test", password="platform12345")
    resp = client.post(
        "/api/v1/platform/auth/login",
        data={"email": "root@platform.test", "password": "platform12345"},
        content_type="application/json",
        HTTP_HOST=BASE_HOST,
    )
    assert resp.status_code == 200, resp.content
    return resp.json()["access"]


def _p(client, token):
    def call(method, path, body=None):
        kw = {"HTTP_HOST": BASE_HOST, "HTTP_AUTHORIZATION": f"Bearer {token}"}
        if body is not None:
            return getattr(client, method)(
                f"/api/v1/platform{path}", data=json.dumps(body),
                content_type="application/json", **kw,
            )
        return getattr(client, method)(f"/api/v1/platform{path}", **kw)

    return call


def test_registry_lists_all_codes_disabled_by_default(client, platform_token, crystal):
    body = _p(client, platform_token)("get", f"/hotels/{crystal.pk}/modules").json()
    assert {m["code"] for m in body["modules"]} == ALL_CODES
    assert all(m["is_enabled"] is False for m in body["modules"])
    # Тарифов нет (62-E1): ни тарифа, ни «источника» в выдаче.
    assert "tariff" not in body and all("source" not in m for m in body["modules"])
    # Переводимая метка на 4 языках у каждого модуля.
    assert all({"ru", "en", "ar", "zh"} <= set(m["title"]) for m in body["modules"])


def test_put_switches_one_module_with_config_defaults(client, platform_token, crystal):
    call = _p(client, platform_token)
    resp = call("put", f"/hotels/{crystal.pk}/modules/room_control", {"enabled": True})
    assert resp.status_code == 200, resp.content
    modules = {m["code"]: m for m in resp.json()["modules"]}
    assert modules["room_control"]["is_enabled"] is True
    # Умолчания настроек — из реестра при первом включении.
    assert modules["room_control"]["config"] == {"guest_entry_demo": False}
    assert call("put", f"/hotels/{crystal.pk}/modules/bogus", {"enabled": True}).status_code == 404
    again = call("get", f"/hotels/{crystal.pk}/modules").json()
    assert {m["code"]: m["is_enabled"] for m in again["modules"]}["room_control"] is True


def test_cms_reads_own_registry(client, platform_token, crystal, cms):
    _p(client, platform_token)("put", f"/hotels/{crystal.pk}/modules/marketing", {"enabled": True})
    body = cms.get("/api/v1/cms/modules").json()
    modules = {m["code"]: m for m in body["modules"]}
    assert set(modules) == ALL_CODES
    assert modules["marketing"]["is_enabled"] is True


def test_enabled_module_codes_helper(crystal):
    from apps.hotels.module_registry import enabled_module_codes, set_modules

    set_modules(crystal, [{"code": "marketing", "is_enabled": True}, {"code": "pms", "is_enabled": False}])
    assert enabled_module_codes(crystal) == {"marketing"}
