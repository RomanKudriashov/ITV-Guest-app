"""
CMS-раздел «Управление номером»: гейтинг модулем и сквозной сценарий.

Главная проверка — ГЕЙТИНГ. Он стоит на каждом эндпоинте, а не на экране:
отель без модуля иначе дотянулся бы до оборудования запросом мимо интерфейса.
Экран спрятать легко, маршрут — нет.

Второе — что гостю ничего не видно: маршруты живут под /api/v1/cms, куда
гостевой токен не пускают в принципе.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from apps.core.context import tenant_context
from apps.hotels.models import HotelModule

from .conftest import host_for

pytestmark = pytest.mark.django_db

PNR = Path(__file__).resolve().parent / "fixtures" / "pnr-variables.xlsx"


def _enable_module(hotel, enabled: bool = True):
    with tenant_context(hotel):
        HotelModule.objects.update_or_create(
            code=HotelModule.Code.ROOM_CONTROL,
            defaults={"is_enabled": enabled, "source": HotelModule.Source.TARIFF},
        )


def _upload(cms, path: str, handle):
    """Загрузка файла: CmsClient шлёт JSON, а здесь нужен multipart."""
    return cms.client.post(
        path,
        data={"file": handle},
        HTTP_HOST=host_for(cms.hotel),
        HTTP_AUTHORIZATION=f"Bearer {cms.token}",
    )


# --- Гейтинг ----------------------------------------------------------------


def test_module_off_closes_every_endpoint(cms, crystal):
    _enable_module(crystal, False)
    for path in ("/grms/catalog", "/grms/types"):
        response = cms.get(f"/api/v1/cms{path}")
        assert response.status_code == 403, path
        assert response.json()["code"] == "module_disabled"


def test_module_on_opens_the_section(cms, crystal):
    _enable_module(crystal)
    response = cms.get("/api/v1/cms/grms/catalog")
    assert response.status_code == 200
    body = response.json()
    assert {e["kind"] for e in body["elements"]} >= {"dnd", "light_group", "air_conditioner"}
    # Каталог отдаётся С СЕРВЕРА: фронт не имеет права знать свой список видов.
    assert body["capabilities"]["current_temp"]["readonly"] is True


def test_guest_token_cannot_reach_the_section(client, crystal, guest_token):
    _enable_module(crystal)
    response = client.get(
        "/api/v1/cms/grms/catalog",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {guest_token}",
    )
    assert response.status_code in (401, 403)


# --- Сквозной сценарий ------------------------------------------------------


def test_import_preview_confirm_build_publish(cms, crystal):
    _enable_module(crystal)

    # 1. Разбор без сохранения.
    with PNR.open("rb") as handle:
        preview = _upload(cms, "/api/v1/cms/grms/import/preview", handle)
    assert preview.status_code == 200, preview.content
    parsed = preview.json()
    assert len(parsed["types"]) == 3
    assert any(w["code"] == "room_in_two_types" for w in parsed["warnings"])

    # 2. Подтверждение — и только теперь запись.
    confirm = cms.post("/api/v1/cms/grms/import/confirm", {"preview": parsed})
    assert confirm.status_code == 200, confirm.content

    types = cms.get("/api/v1/cms/grms/types").json()["types"]
    assert len(types) == 3
    code = types[0]["code"]
    assert types[0]["variables"], "переменные обязаны появиться"

    # 3. Конструктор: зона, элемент, привязка.
    assert cms.post(f"/api/v1/cms/grms/types/{code}/zones",
                    {"code": "bedroom", "title": {"ru": "Спальня"}}).status_code == 200

    light = next(v for v in types[0]["variables"] if v["command"].startswith("C_Light"))
    assert cms.post(f"/api/v1/cms/grms/types/{code}/elements",
                    {"kind": "light_group", "slug": "light.main",
                     "zone_code": "bedroom"}).status_code == 200
    bound = cms.post(f"/api/v1/cms/grms/types/{code}/bindings",
                     {"element_slug": "light.main", "capability": "toggle",
                      "variable_key": light["key"]})
    assert bound.status_code == 200, bound.content

    # 4. Непривязанный элемент остаётся скрытым.
    cms.post(f"/api/v1/cms/grms/types/{code}/elements",
             {"kind": "master_switch", "slug": "master"})
    status = cms.get(f"/api/v1/cms/grms/types/{code}/status").json()
    assert status["publishable"] == ["light.main"]
    assert [h["slug"] for h in status["hidden"]] == ["master"]

    # 5. Публикация и история.
    published = cms.post(f"/api/v1/cms/grms/types/{code}/publish")
    assert published.status_code == 200, published.content
    assert published.json()["version"] == 1

    versions = cms.get(f"/api/v1/cms/grms/types/{code}/versions").json()["versions"]
    assert [v["version"] for v in versions] == [1]
    assert versions[0]["controls"] == 1


def test_binding_validation_surfaces_as_422(cms, crystal):
    """Несовместимость обязана быть видна администратору, а не уехать в железо."""
    _enable_module(crystal)
    with PNR.open("rb") as handle:
        parsed = _upload(cms, "/api/v1/cms/grms/import/preview", handle).json()
    cms.post("/api/v1/cms/grms/import/confirm", {"preview": parsed})

    code = cms.get("/api/v1/cms/grms/types").json()["types"][0]["code"]
    cms.post(f"/api/v1/cms/grms/types/{code}/elements",
             {"kind": "air_conditioner", "slug": "ac.1"})

    response = cms.post(f"/api/v1/cms/grms/types/{code}/bindings",
                        {"element_slug": "ac.1", "capability": "setpoint",
                         "variable_key": "dnd"})
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


def test_reconcile_without_a_connector_does_not_block(cms, crystal):
    """
    Стоп-guard: коннектор офлайн — сверка не запускается, но сохранение
    остаётся разрешённым. Объект настраивают и до подключения коробки.
    """
    _enable_module(crystal)
    with PNR.open("rb") as handle:
        parsed = _upload(cms, "/api/v1/cms/grms/import/preview", handle).json()

    response = cms.post("/api/v1/cms/grms/import/reconcile", {"preview": parsed})
    assert response.status_code == 200
    body = response.json()
    assert body["checked"] is False
    assert all(r["reason"] == "not_checked" for r in body["reports"])

    confirm = cms.post("/api/v1/cms/grms/import/confirm", {"preview": parsed})
    assert confirm.status_code == 200, "несверенный импорт обязан сохраняться"


def test_broken_file_is_refused_with_an_explanation(cms, crystal):
    _enable_module(crystal)
    import io

    response = _upload(cms, "/api/v1/cms/grms/import/preview",
                       io.BytesIO(b"not a workbook at all"))
    assert response.status_code == 422
