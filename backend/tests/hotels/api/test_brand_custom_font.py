"""
Свой шрифт отеля: файл, его проверка и право выбрать это семейство.

Курируемый список остаётся списком — свой шрифт не обходит его, а дополняет.
Отсюда два правила, которые здесь и проверяются: файл обязан БЫТЬ шрифтом (по
сигнатуре, а не по заголовку от браузера), а семейство своего шрифта разрешено
ровно тому отелю, который этот файл загрузил.
"""

from __future__ import annotations

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.core.context import tenant_context
from apps.media.models import MediaAsset

from tests.conftest import host_for

pytestmark = pytest.mark.django_db

# Заголовок woff2: четыре байта сигнатуры и немного мусора следом. Настоящий
# шрифт здесь не нужен — сервер проверяет сигнатуру, а рисует браузер, и это
# проверяется в e2e.
WOFF2 = b"wOF2" + b"\x00" * 64


def _upload(cms, content: bytes, name: str = "Мой Гротеск.woff2"):
    return cms.upload(
        "/api/cms/brand/font",
        {"file": SimpleUploadedFile(name, content, content_type="font/woff2")},
    )


def test_font_is_stored_and_named(cms, crystal):
    response = _upload(cms, WOFF2)
    assert response.status_code == 200, response.content

    body = response.json()
    assert body["name"] == "Мой Гротеск"
    assert body["family"] == "'Мой Гротеск', system-ui, sans-serif"
    assert body["url"], "адрес файла не отдан — выбирать будет нечего"
    assert body["format"] == "woff2"

    # Чтение тенантной таблицы — только в контексте отеля: RLS иначе честно
    # отдаёт ноль строк, и тест соврал бы про «ассета нет».
    with tenant_context(crystal.id):
        asset = MediaAsset.objects.get(pk=body["assetId"])
    # Готов сразу: шрифту нечего нарезать, и ждать Celery ему незачем.
    assert asset.kind == "font"
    assert asset.status == MediaAsset.Status.READY


def test_a_text_file_with_the_right_extension_is_refused(cms):
    """
    Проверяем СИГНАТУРУ, а не Content-Type.

    Браузеры шлют шрифты то как `font/woff2`, то как `application/octet-stream`;
    довериться заголовку значит пустить в хранилище что угодно под правильным
    именем.
    """
    response = _upload(cms, "это просто текст".encode())
    assert response.status_code == 422, response.content
    # Смотрим на КОД ошибки, а не на текст: текст уходит в JSON экранированными
    # последовательностями, и проверка по подстроке молча зеленела бы на любом
    # другом отказе.
    assert response.json()["code"] == "not_a_font"


def test_a_huge_file_is_refused(cms):
    response = _upload(cms, WOFF2 + b"\x00" * (2 * 1024 * 1024))
    assert response.status_code == 422, response.content


def test_custom_family_is_allowed_only_after_upload(cms):
    """Семейство своего шрифта — не лазейка мимо курируемого списка."""
    refused = cms.patch(
        "/api/cms/brand",
        {"tokens": {"typography": {"fontFamily": "'Чужой Шрифт', system-ui, sans-serif"}}},
    )
    assert refused.status_code == 422, refused.content

    uploaded = _upload(cms, WOFF2).json()
    saved = cms.patch(
        "/api/cms/brand",
        {
            "tokens": {
                "brand": {"customFont": {
                    "name": uploaded["name"],
                    "family": uploaded["family"],
                    "url": uploaded["url"],
                    "assetId": uploaded["assetId"],
                    "format": uploaded["format"],
                }},
                "typography": {"fontFamily": uploaded["family"]},
            }
        },
    )
    assert saved.status_code == 200, saved.content


def test_custom_font_reaches_the_guest(client, crystal, cms):
    """Шрифт, выбранный в панели, приезжает витрине — вместе с адресом файла."""
    uploaded = _upload(cms, WOFF2).json()
    cms.patch(
        "/api/cms/brand",
        {
            "tokens": {
                "brand": {"customFont": {
                    "name": uploaded["name"],
                    "family": uploaded["family"],
                    "url": uploaded["url"],
                    "assetId": uploaded["assetId"],
                    "format": uploaded["format"],
                }},
                "typography": {"fontFamily": uploaded["family"]},
            }
        },
    )

    response = client.post(
        "/api/guest/session",
        data={"room_number": "305"},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
    )
    theme = response.json()["hotel"]["theme"]

    assert theme["typography"]["fontFamily"] == uploaded["family"]
    assert theme["brand"]["customFont"]["url"], "гостю приехало семейство без файла"


def test_deleted_font_file_leaves_no_broken_link(client, crystal, cms):
    """
    Файл удалили — адрес пуст, а не битая ссылка.

    Витрина в этом случае берёт запасное семейство и остаётся читаемой. Битая
    ссылка выглядела бы так же, но стоила бы гостю секунды ожидания на каждом
    экране.
    """
    uploaded = _upload(cms, WOFF2).json()
    cms.patch(
        "/api/cms/brand",
        {"tokens": {"brand": {"customFont": {
            "name": uploaded["name"],
            "family": uploaded["family"],
            "url": uploaded["url"],
            "assetId": uploaded["assetId"],
        }}}},
    )

    with tenant_context(crystal.id):
        MediaAsset.objects.filter(pk=uploaded["assetId"]).delete()

    response = client.post(
        "/api/guest/session",
        data={"room_number": "305"},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
    )
    theme = response.json()["hotel"]["theme"]
    assert theme["brand"]["customFont"]["url"] == ""


def test_only_the_admin_uploads_a_font(client, crystal, guest_token):
    response = client.post(
        "/api/cms/brand/font",
        data={"file": SimpleUploadedFile("f.woff2", WOFF2, content_type="font/woff2")},
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {guest_token}",
    )
    assert response.status_code == 401
