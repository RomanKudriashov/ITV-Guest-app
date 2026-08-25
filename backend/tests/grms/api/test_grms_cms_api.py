"""
CMS-раздел «Управление номером»: гейтинг модулем и сквозной сценарий.

Главная проверка — ГЕЙТИНГ. Он стоит на каждом эндпоинте, а не на экране:
отель без модуля иначе дотянулся бы до оборудования запросом мимо интерфейса.
Экран спрятать легко, маршрут — нет.

Второе — что гостю ничего не видно: маршруты живут под /api/v1/cms, куда
гостевой токен не пускают в принципе.
"""

from __future__ import annotations


import pytest

from tests.helpers import FIXTURES

from apps.core.context import tenant_context
from apps.hotels.models import HotelModule

from tests.conftest import host_for

pytestmark = pytest.mark.django_db

PNR = FIXTURES / "pnr-variables.xlsx"


def _enable_module(hotel, enabled: bool = True):
    with tenant_context(hotel):
        HotelModule.objects.update_or_create(
            code=HotelModule.Code.ROOM_CONTROL,
            defaults={"is_enabled": enabled},
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
    """
    Гейтинг проверяется по тем ручкам, что у отеля ОСТАЛИСЬ: конфигурация
    переехала в консоль платформы, и её маршрутов под `/cms` больше нет вовсе.
    Гейтинг платформенной стороны — в `test_grms_ownership`.
    """
    _enable_module(crystal, False)
    for path in ("/grms/types", "/grms/access", "/grms/diagnostics/link"):
        response = cms.get(f"/api/v1/cms{path}")
        assert response.status_code == 403, path
        assert response.json()["code"] == "module_disabled"


def test_module_on_opens_the_section(cms, crystal):
    _enable_module(crystal)
    response = cms.get("/api/v1/cms/grms/types")
    assert response.status_code == 200
    assert "types" in response.json()


def test_guest_token_cannot_reach_the_section(client, crystal, guest_token):
    _enable_module(crystal)
    response = client.get(
        "/api/v1/cms/grms/types",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {guest_token}",
    )
    assert response.status_code in (401, 403)


# --- Сквозной сценарий конфигурации ------------------------------------------
#
# Он ПЕРЕЕХАЛ вместе с ручками: путь «импорт → конструктор → публикация»
# проверяется набором консоли (`e2e/tests/room-control-console.spec.ts`) и
# укусами владения (`test_grms_ownership`). Держать здесь его копию, бьющую в
# несуществующие адреса, значило бы проверять путь, которым никто не ходит.
