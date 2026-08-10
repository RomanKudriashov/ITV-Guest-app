"""CMS: загрузка медиа (реальный пайплайн MinIO + Pillow) и расписания."""

from __future__ import annotations

import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.core.context import tenant_context
from apps.media.models import MediaAsset
from apps.media.tasks import process_media_asset

pytestmark = pytest.mark.django_db


def png_bytes(size=(800, 600)) -> bytes:
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", size, (12, 34, 56)).save(buffer, format="PNG")
    return buffer.getvalue()


# --- Медиа -----------------------------------------------------------------


def test_upload_returns_pending_asset(cms):
    response = cms.upload(
        "/api/cms/media",
        {"file": SimpleUploadedFile("steak.png", png_bytes(), content_type="image/png")},
        {"kind": "item"},
    )
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["status"] == "pending"
    # Пока варианты не нарезаны, URL пустые — UI показывает локальное превью.
    assert body["url"] == "" and body["thumb_url"] == ""
    assert cms.get(f"/api/cms/media/{body['id']}").json()["id"] == body["id"]


def test_pipeline_produces_variants(cms, crystal):
    """
    Прогоняем задачу напрямую: проверяем настоящий путь оригинал → MinIO →
    Pillow → варианты, а не заглушку.
    """
    asset_id = cms.upload(
        "/api/cms/media",
        {"file": SimpleUploadedFile("dish.png", png_bytes(), content_type="image/png")},
    ).json()["id"]

    process_media_asset.apply(args=(asset_id, str(crystal.pk))).get()

    with tenant_context(crystal):
        asset = MediaAsset.objects.get(pk=asset_id)
    assert asset.status == MediaAsset.Status.READY
    assert set(asset.variants) == {"thumb", "card", "full"}
    assert asset.width == 800 and asset.height == 600

    body = cms.get(f"/api/cms/media/{asset_id}").json()
    assert body["url"].startswith("http") and body["thumb_url"].startswith("http")


@pytest.mark.parametrize(
    "filename,content,content_type,code",
    [
        ("virus.exe", b"MZ\x00", "application/octet-stream", "unsupported_media"),
        ("huge.png", b"x" * (10 * 1024 * 1024 + 1), "image/png", "file_too_large"),
    ],
)
def test_upload_rejects_bad_files(cms, filename, content, content_type, code):
    response = cms.upload(
        "/api/cms/media",
        {"file": SimpleUploadedFile(filename, content, content_type=content_type)},
    )
    assert response.status_code == 422
    assert response.json()["code"] == code


def test_attach_images_to_item(cms, category_id):
    item = cms.post(
        "/api/cms/items",
        {"category_id": category_id, "title": {"en": "Photo dish"}, "price": 1000},
    ).json()

    ids = [
        cms.upload(
            "/api/cms/media",
            {"file": SimpleUploadedFile(f"{n}.png", png_bytes(), content_type="image/png")},
        ).json()["id"]
        for n in ("a", "b")
    ]

    response = cms.put(f"/api/cms/items/{item['id']}/images", {"image_ids": ids})
    assert response.status_code == 200
    assert [img["id"] for img in response.json()["images"]] == ids

    # Порядок задаётся порядком списка — перестановка сохраняется.
    swapped = cms.put(
        f"/api/cms/items/{item['id']}/images", {"image_ids": list(reversed(ids))}
    ).json()
    assert [img["id"] for img in swapped["images"]] == list(reversed(ids))

    cleared = cms.put(f"/api/cms/items/{item['id']}/images", {"image_ids": []}).json()
    assert cleared["images"] == []


def test_attach_unknown_image_is_rejected(cms, category_id):
    item = cms.post(
        "/api/cms/items", {"category_id": category_id, "title": {"en": "X"}}
    ).json()
    response = cms.put(
        f"/api/cms/items/{item['id']}/images",
        {"image_ids": ["00000000-0000-0000-0000-000000000000"]},
    )
    assert response.status_code == 422


# --- Расписания ------------------------------------------------------------


def test_create_and_apply_schedule(cms, category_id):
    created = cms.post(
        "/api/cms/schedules",
        {
            "name": "Ужин",
            "intervals": [
                {"weekday": day, "start_time": "18:00", "end_time": "23:30", "day_part": "dinner"}
                for day in range(7)
            ],
        },
    )
    assert created.status_code == 201, created.content
    schedule = created.json()
    assert len(schedule["intervals"]) == 7
    assert schedule["intervals"][0]["start_time"] == "18:00"

    item = cms.post(
        "/api/cms/items",
        {
            "category_id": category_id,
            "title": {"en": "Dinner dish"},
            "schedule_id": schedule["id"],
        },
    ).json()
    assert item["schedule_id"] == schedule["id"]

    assert schedule["id"] in [s["id"] for s in cms.get("/api/cms/schedules").json()]


def test_schedule_across_midnight_is_allowed(cms):
    """Ночной бар: 23:00–02:00 — валидный интервал, а не ошибка ввода."""
    response = cms.post(
        "/api/cms/schedules",
        {
            "name": "Ночной бар",
            "intervals": [{"weekday": 4, "start_time": "23:00", "end_time": "02:00"}],
        },
    )
    assert response.status_code == 201


@pytest.mark.parametrize(
    "payload,expected_field",
    [
        ({"name": "", "intervals": []}, "name"),
        ({"name": "Пусто", "intervals": []}, "intervals"),
        (
            {"name": "Кривое", "intervals": [{"weekday": 9, "start_time": "10:00", "end_time": "11:00"}]},
            "intervals.0.weekday",
        ),
        (
            {"name": "Кривое", "intervals": [{"weekday": 1, "start_time": "25:00", "end_time": "11:00"}]},
            "intervals.0.start_time",
        ),
        (
            {"name": "Нулевое", "intervals": [{"weekday": 1, "start_time": "10:00", "end_time": "10:00"}]},
            "intervals.0.end_time",
        ),
    ],
)
def test_schedule_validation(cms, payload, expected_field):
    response = cms.post("/api/cms/schedules", payload)
    assert response.status_code == 422, response.content
    assert response.json()["field"] == expected_field


def test_delete_schedule_releases_items(cms, category_id):
    schedule = cms.post(
        "/api/cms/schedules",
        {"name": "Временное", "intervals": [{"weekday": 0, "start_time": "09:00", "end_time": "10:00"}]},
    ).json()
    item = cms.post(
        "/api/cms/items",
        {"category_id": category_id, "title": {"en": "Temp"}, "schedule_id": schedule["id"]},
    ).json()

    assert cms.delete(f"/api/cms/schedules/{schedule['id']}").status_code == 200

    # Без расписания позиция доступна всегда — а не «по расписанию, которого нет».
    assert cms.get(f"/api/cms/items/{item['id']}").json()["schedule_id"] is None
