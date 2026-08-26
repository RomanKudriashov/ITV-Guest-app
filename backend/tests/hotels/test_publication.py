"""
ПУБЛИКАЦИЯ: применить одно ко многим и честно отчитаться.

Первая фоновая операция такого рода в проекте. Проверяется не «работает», а
четыре свойства, ради которых она устроена именно так:

* повтор не плодит — идемпотентность по ключу источника;
* локальная правка отеля не перетирается, и отчёт называет причину;
* отказ на одном отеле не роняет остальных;
* предпросмотр считает тем же кодом, что и применение.

Задача гоняется синхронно (`CELERY_TASK_ALWAYS_EAGER` в тестовых настройках или
прямой вызов сервиса): проверяется тело операции, а не доставка сообщения.
"""

from __future__ import annotations

import json

import pytest

from apps.catalog.models import Badge
from apps.core.context import tenant_context
from apps.hotels.models import Hotel, HotelGroup, PublicationJob, PublicationResult
from apps.hotels.services.platform import publication

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

PLATFORM_EMAIL = "root@platform.test"
PLATFORM_PASSWORD = "platform12345"
BASE_HOST = "guest.localhost"
PRESET = "autumn-hit"


@pytest.fixture
def api(client):
    from apps.hotels.services.provisioning import ensure_platform_admin

    ensure_platform_admin(email=PLATFORM_EMAIL, password=PLATFORM_PASSWORD)
    token = client.post(
        "/api/v1/platform/auth/login",
        data=json.dumps({"email": PLATFORM_EMAIL, "password": PLATFORM_PASSWORD}),
        content_type="application/json",
        HTTP_HOST=BASE_HOST,
    ).json()["access"]

    def call(method: str, path: str, body=None):
        kwargs = {"HTTP_HOST": BASE_HOST, "HTTP_AUTHORIZATION": f"Bearer {token}"}
        if body is not None:
            return getattr(client, method)(
                f"/api/v1/platform{path}",
                data=json.dumps(body),
                content_type="application/json",
                **kwargs,
            )
        return getattr(client, method)(f"/api/v1/platform{path}", **kwargs)

    return call


def _hotel(subdomain: str) -> Hotel:
    from apps.hotels.services.provisioning import provision_hotel

    return provision_hotel(
        subdomain=subdomain, name=subdomain.title(), admin_email=f"a@{subdomain}.test"
    ).hotel


def _payload(label: str = "Осенний хит", order: int = 0) -> dict:
    return {"preset": PRESET, "label": {"ru": label}, "color_role": "gold", "sort_order": order}


def _publish(hotels, payload=None) -> PublicationJob:
    """Публикация на перечень отелей, выполненная здесь же."""
    job = publication.start(
        kind="badge",
        payload=payload or _payload(),
        scope=PublicationJob.Scope.HOTELS,
        hotel_ids=[str(hotel.pk) for hotel in hotels],
    )
    publication.run(str(job.pk))
    job.refresh_from_db()
    return job


def _badges(hotel, preset=PRESET):
    with tenant_context(hotel):
        return list(Badge.objects.filter(preset=preset))


def test_a_repeat_updates_and_does_not_multiply(api):
    """
    УКУС. Повторная публикация обновляет свою запись, а не заводит вторую.

    Ключ — `preset`, код библиотеки платформы: по названию искать нельзя, отель
    волен его переименовать, и тогда мы бы завели дубль рядом.
    """
    hotel = _hotel("pub-repeat")

    _publish([hotel])
    assert len(_badges(hotel)) == 1

    job = _publish([hotel], _payload("Осенний хит, второй заход", order=3))
    assert len(_badges(hotel)) == 1, "повтор завёл вторую запись"

    with tenant_context(hotel):
        badge = Badge.objects.get(preset=PRESET)
    assert badge.label["ru"] == "Осенний хит, второй заход"
    assert badge.sort_order == 3

    outcomes = {row.outcome for row in PublicationResult.objects.filter(job=job)}
    assert outcomes == {PublicationResult.Outcome.APPLIED}


def test_an_identical_repeat_is_skipped_not_counted_as_work(api):
    """Повтор того же самого — `skipped`. «Применено 200» на пустом месте — ложь."""
    hotel = _hotel("pub-same")
    _publish([hotel])
    job = _publish([hotel])

    row = PublicationResult.objects.get(job=job, hotel=hotel)
    assert row.outcome == PublicationResult.Outcome.SKIPPED
    assert "совпадает" in row.detail


def test_a_local_edit_is_never_overwritten_and_the_report_says_why(api):
    """
    УКУС. Отель переименовал наш бейдж — публикация его НЕ трогает.

    Обоснование то же, что у эталона справочника: правка человека не
    перетирается автоматически нигде. Публикация не спорит с отелем, а
    сообщает платформе, что здесь разошлись, — отдельной строкой отчёта с
    причиной.
    """
    hotel = _hotel("pub-edited")
    _publish([hotel])

    with tenant_context(hotel):
        badge = Badge.objects.get(preset=PRESET)
        badge.label = {"ru": "По-нашему"}
        badge.save(update_fields=["label"])

    job = _publish([hotel], _payload("Новая наша редакция"))

    row = PublicationResult.objects.get(job=job, hotel=hotel)
    assert row.outcome == PublicationResult.Outcome.SKIPPED
    assert "своя правка" in row.detail

    with tenant_context(hotel):
        assert Badge.objects.get(preset=PRESET).label["ru"] == "По-нашему"


def test_a_failure_on_one_hotel_does_not_stop_the_rest(api, monkeypatch):
    """
    УКУС. Отказ на одном отеле не роняет остальные.

    Иначе двухсотый отель отменял бы работу первых ста девяноста девяти, а
    повторный запуск начинал бы всё заново.
    """
    good_one = _hotel("pub-good-one")
    broken = _hotel("pub-broken")
    good_two = _hotel("pub-good-two")

    original = publication.BadgePublisher.apply

    def explode(self, hotel, payload, *, previous=None):
        if hotel.subdomain == "pub-broken":
            raise RuntimeError("оборудование отеля отвалилось")
        return original(self, hotel, payload, previous=previous)

    monkeypatch.setattr(publication.BadgePublisher, "apply", explode)

    job = _publish([good_one, broken, good_two])

    results = {row.hotel.subdomain: row for row in PublicationResult.objects.filter(job=job).select_related("hotel")}
    assert results["pub-broken"].outcome == PublicationResult.Outcome.FAILED
    assert "оборудование отеля отвалилось" in results["pub-broken"].detail
    assert results["pub-good-one"].outcome == PublicationResult.Outcome.APPLIED
    assert results["pub-good-two"].outcome == PublicationResult.Outcome.APPLIED

    # И вся операция при этом ЗАВЕРШЕНА, а не «упала»: отказ одного отеля —
    # это результат, а не поломка публикации.
    assert job.status == PublicationJob.Status.DONE


def test_the_preview_matches_what_was_applied(api):
    """
    УКУС. Предпросмотр и применение считают цель одним кодом — включая
    группу-правило, состав которой вычисляемый.
    """
    first = _hotel("pub-city-one")
    second = _hotel("pub-city-two")
    _hotel("pub-elsewhere")

    for hotel in (first, second):
        hotel.city = {"ru": "Публиковка"}
        hotel.save(update_fields=["city"])

    created = api(
        "post",
        "/groups",
        {"code": "pubcity", "title": "Публиковка", "kind": "city", "mode": "rule",
         "rule": {"city": "Публиковка"}},
    )
    group_id = created.json()["id"]

    preview = api(
        "post",
        "/publications/preview",
        {"kind": "badge", "payload": _payload(), "scope": "group", "group_id": group_id},
    ).json()
    assert preview["count"] == 2
    assert set(preview["sample"]) == {"pub-city-one", "pub-city-two"}

    started = api(
        "post",
        "/publications",
        {"kind": "badge", "payload": _payload(), "scope": "group", "group_id": group_id},
    )
    assert started.status_code == 201, started.content
    job_id = started.json()["id"]
    publication.run(job_id)

    report = api("get", f"/publications/{job_id}").json()
    assert report["planned"] == preview["count"], "предпросмотр и цель разошлись"
    assert len(report["results"]) == preview["count"]
    assert {row["subdomain"] for row in report["results"]} == set(preview["sample"])


def test_the_report_answers_per_hotel_not_just_done(api):
    """Отчёт — строка на отель с исходом и причиной, а не «готово»."""
    hotel = _hotel("pub-report")
    job = _publish([hotel])

    report = api("get", f"/publications/{job.pk}").json()
    assert report["status"] == "done"
    assert report["counts"] == {"applied": 1}
    assert report["pending"] == 0
    assert report["results"][0]["subdomain"] == "pub-report"
    assert report["results"][0]["detail"]


def test_publishing_to_the_whole_fleet_is_the_owners_right(api):
    """
    ПРАВО ПО ВЕСУ. На весь флот — только владелец; на группу и перечень
    достаточно поддержки, то есть того же права, которым эти отели правятся по
    одному.
    """
    from apps.accounts.models import User
    from apps.core.errors import PermissionDenied

    support = User(platform_role="support")
    owner = User(platform_role="owner")

    publication.check_rights(support, PublicationJob.Scope.HOTELS)
    publication.check_rights(support, PublicationJob.Scope.GROUP)
    publication.check_rights(owner, PublicationJob.Scope.ALL)

    with pytest.raises(PermissionDenied) as exc:
        publication.check_rights(support, PublicationJob.Scope.ALL)
    assert exc.value.code == "owner_required"


def test_an_interrupted_run_resumes_and_does_not_redo(api, monkeypatch):
    """
    ПЕРЕЗАПУСК ВОРКЕРА. Состояние живёт в базе: отели с записанным результатом
    пропускаются, и «сто из двухсот» переживает падение исполнителя.
    """
    first = _hotel("pub-resume-one")
    second = _hotel("pub-resume-two")

    job = publication.start(
        kind="badge",
        payload=_payload(),
        scope=PublicationJob.Scope.HOTELS,
        hotel_ids=[str(first.pk), str(second.pk)],
    )

    # Первый заход обрывается после первого отеля.
    original = publication._apply_one
    seen: list[str] = []

    def once(publisher, hotel, payload, previous):
        if seen:
            raise RuntimeError("воркер убит")
        seen.append(hotel.subdomain)
        return original(publisher, hotel, payload, previous)

    monkeypatch.setattr(publication, "_apply_one", once)
    with pytest.raises(RuntimeError):
        publication.run(str(job.pk))

    assert PublicationResult.objects.filter(job=job).count() == 1

    # Задача приехала снова — доделывает остаток, не переделывая сделанное.
    monkeypatch.setattr(publication, "_apply_one", original)
    publication.run(str(job.pk))

    assert PublicationResult.objects.filter(job=job).count() == 2
    job.refresh_from_db()
    assert job.status == PublicationJob.Status.DONE
