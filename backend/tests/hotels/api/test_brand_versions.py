"""
Черновики, версии и откат оформления.

Три вещи, которые здесь проверяются по существу, а не по форме ответа:
история не имеет дыр (любая публикация оставляет версию), откат виден КАК
откат, и устаревший черновик не публикуется молча.
"""

from __future__ import annotations

import pytest

from apps.core.context import tenant_context
from apps.hotels.models import BrandVersion

from tests.conftest import host_for

pytestmark = pytest.mark.django_db


def _versions(cms) -> list[dict]:
    response = cms.get("/api/cms/brand/versions")
    assert response.status_code == 200, response.content
    return response.json()["versions"]


def _drafts(cms) -> list[dict]:
    response = cms.get("/api/cms/brand/drafts")
    assert response.status_code == 200, response.content
    return response.json()["drafts"]


def _new_draft(cms, name: str, tokens: dict) -> dict:
    response = cms.post("/api/cms/brand/drafts", {"name": name, "tokens": tokens})
    assert response.status_code == 200, response.content
    return response.json()


# --- История ---------------------------------------------------------------


def test_every_save_leaves_a_version(cms):
    """
    История без дыр. Прямое сохранение из редактора — тоже публикация: гость
    видит именно её, и «предыдущая версия» обязана означать то, что было на
    витрине до неё.
    """
    assert _versions(cms) == []

    cms.patch("/api/cms/brand", {"tokens": {"palette": {"light": {"primary": "#112233"}}}})
    cms.patch("/api/cms/brand", {"tokens": {"palette": {"light": {"primary": "#445566"}}}})

    versions = _versions(cms)
    assert [v["number"] for v in versions] == [2, 1]
    assert all(v["author"] for v in versions), "версия без автора — история без ответа «кто»"


def test_preset_and_replace_are_versions_too(cms):
    """Пресет и замена набора целиком — тоже то, что увидит гость."""
    cms.post("/api/cms/brand/apply-preset", {"preset": "midnight_navy"})
    versions = _versions(cms)

    assert len(versions) == 1
    assert "midnight_navy" in versions[0]["name"]


# --- Черновики -------------------------------------------------------------


def test_drafts_are_many_and_named(cms):
    """
    ЧЕРНОВИКОВ НЕСКОЛЬКО. Новогоднее оформление и открытие террасы — разные
    замыслы; держать их по одному значит заставлять выбирать, что потерять.
    """
    _new_draft(cms, "Новый год", {"palette": {"light": {"primary": "#B00020"}}})
    _new_draft(cms, "Открытие террасы", {"palette": {"light": {"primary": "#2E7D32"}}})

    drafts = _drafts(cms)
    assert {d["name"] for d in drafts} == {"Новый год", "Открытие террасы"}
    assert all(d["created_at"] for d in drafts), "черновик без даты не отличить от другого"
    assert all(d["author"] for d in drafts)


def test_a_draft_does_not_reach_the_guest_until_published(client, crystal, cms):
    """Черновик — снимок, который видит ПАНЕЛЬ. Витрина о нём не знает."""
    _new_draft(cms, "Новый год", {"palette": {"light": {"primary": "#B00020"}}})

    theme = client.post(
        "/api/guest/session",
        data={"room_number": "305"},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
    ).json()["hotel"]["theme"]
    assert theme["palette"]["light"]["primary"].lower() != "#b00020"


def test_publishing_a_draft_reaches_the_guest_and_removes_the_draft(client, crystal, cms):
    draft = _new_draft(cms, "Новый год", {"palette": {"light": {"primary": "#B00020"}}})

    published = cms.post(f"/api/cms/brand/drafts/{draft['id']}/publish")
    assert published.status_code == 200, published.content
    assert published.json()["number"] == 1

    theme = client.post(
        "/api/guest/session",
        data={"room_number": "305"},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
    ).json()["hotel"]["theme"]
    assert theme["palette"]["light"]["primary"].lower() == "#b00020"

    # Черновик израсходован: оставленный, он немедленно стал бы устаревшим и
    # предложил бы опубликовать то же самое ещё раз.
    assert _drafts(cms) == []


# --- Сторож устаревшего черновика ------------------------------------------


def test_a_stale_draft_is_refused_with_both_versions_named(cms):
    """
    Пока один правил, другой опубликовал. Такой черновик не «немного отстал» —
    он не знает о чужой работе вообще и сотрёт её целиком.
    """
    cms.patch("/api/cms/brand", {"tokens": {"palette": {"light": {"primary": "#111111"}}}})
    draft = _new_draft(cms, "Моя правка", {"palette": {"light": {"primary": "#222222"}}})

    # Кто-то другой публикует своё.
    cms.patch("/api/cms/brand", {"tokens": {"palette": {"light": {"primary": "#333333"}}}})

    assert _drafts(cms)[0]["is_stale"] is True

    refused = cms.post(f"/api/cms/brand/drafts/{draft['id']}/publish")
    assert refused.status_code == 422, refused.content
    body = refused.json()
    assert body["code"] == "draft_stale"
    # Обе версии названы: без этого оператору нечего сравнивать.
    assert "1" in body["detail"] and "2" in body["detail"]


def test_a_stale_draft_publishes_only_with_an_explicit_confirmation(cms):
    cms.patch("/api/cms/brand", {"tokens": {"palette": {"light": {"primary": "#111111"}}}})
    draft = _new_draft(cms, "Моя правка", {"palette": {"light": {"primary": "#222222"}}})
    cms.patch("/api/cms/brand", {"tokens": {"palette": {"light": {"primary": "#333333"}}}})

    ok = cms.post(f"/api/cms/brand/drafts/{draft['id']}/publish?confirm_stale=true")
    assert ok.status_code == 200, ok.content
    assert ok.json()["number"] == 3


def test_a_fresh_draft_is_not_stale(cms):
    cms.patch("/api/cms/brand", {"tokens": {"palette": {"light": {"primary": "#111111"}}}})
    _new_draft(cms, "Свежий", {"palette": {"light": {"primary": "#222222"}}})

    assert _drafts(cms)[0]["is_stale"] is False


# --- Откат -----------------------------------------------------------------


def test_restore_puts_the_old_tokens_back_and_is_marked_as_a_restore(client, crystal, cms):
    """
    ОТКАТ ВИДЕН КАК ОТКАТ. Иначе история — ровный ряд публикаций, в котором
    непонятно, почему оформление вдруг стало прежним.
    """
    cms.patch("/api/cms/brand", {"tokens": {"palette": {"light": {"primary": "#111111"}}}})
    first = _versions(cms)[0]
    cms.patch("/api/cms/brand", {"tokens": {"palette": {"light": {"primary": "#999999"}}}})

    restored = cms.post(f"/api/cms/brand/versions/{first['id']}/restore")
    assert restored.status_code == 200, restored.content

    body = restored.json()
    assert body["number"] == 3, "откат ложится сверху, а не отматывает историю"
    assert body["restored_from"]["number"] == 1
    assert body["author"], "непонятно, кто вернул"
    assert body["published_at"], "непонятно, когда вернули"

    theme = client.post(
        "/api/guest/session",
        data={"room_number": "305"},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
    ).json()["hotel"]["theme"]
    assert theme["palette"]["light"]["primary"].lower() == "#111111"


def test_restore_keeps_the_versions_in_between(cms):
    """Версии между «сейчас» и «тогда» были, и витрина их показывала."""
    cms.patch("/api/cms/brand", {"tokens": {"palette": {"light": {"primary": "#111111"}}}})
    first = _versions(cms)[0]
    cms.patch("/api/cms/brand", {"tokens": {"palette": {"light": {"primary": "#999999"}}}})

    cms.post(f"/api/cms/brand/versions/{first['id']}/restore")

    assert [v["number"] for v in _versions(cms)] == [3, 2, 1]


# --- Метка «своё оформление» ------------------------------------------------


def test_the_look_badge_names_the_published_version(cms):
    """
    Метка считается по ОПУБЛИКОВАННОМУ оформлению. С черновиками это перестало
    совпадать с тем, что оператор видит в редакторе, — значит, версия должна
    быть названа, иначе метка говорит правду, которую примут за ложь.
    """
    before = cms.get("/api/cms/brand/look").json()
    assert before["version"] is None, "версии нет, а метка на что-то ссылается"

    cms.patch("/api/cms/brand", {"tokens": {"palette": {"light": {"primary": "#111111"}}}})

    after = cms.get("/api/cms/brand/look").json()
    assert after["version"] == 1
    assert after["version_published_at"]


# --- Права и изоляция -------------------------------------------------------


def test_drafts_of_another_hotel_are_invisible(cms, cms_aurora, crystal, aurora):
    _new_draft(cms, "Мой черновик", {})
    assert _drafts(cms_aurora) == []

    with tenant_context(crystal.id):
        assert BrandVersion.objects.filter(kind="draft").count() == 1
    with tenant_context(aurora.id):
        assert BrandVersion.objects.filter(kind="draft").count() == 0


def test_a_guest_cannot_read_drafts(client, crystal, guest_token):
    response = client.get(
        "/api/cms/brand/drafts",
        HTTP_HOST=host_for(crystal),
        HTTP_AUTHORIZATION=f"Bearer {guest_token}",
    )
    assert response.status_code == 401
