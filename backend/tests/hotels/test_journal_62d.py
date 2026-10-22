"""
ИСТОРИЯ И ЖУРНАЛЫ (партия 62-D).

Укусы:
* модули пишут «был → стал» по каждому изменившемуся коду, а не «изменено 9»;
* одно действие — одна запись: вход поддержки, публикация и откат
  конфигурации номера больше не пишутся дважды, старые дубли в показе
  схлопнуты;
* «История» отеля фильтруется на сервере и листается курсором дальше 50;
* «Журнал действий», «Команда», «Справочники», «Подключения» фильтруются на
  сервере.
"""

from __future__ import annotations

import json
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.core.context import tenant_context
from apps.core.models import AuditLog
from apps.hotels.models import Hotel, HotelModule

pytestmark = pytest.mark.django_db(transaction=True, databases=["default", "platform"])

PLATFORM_EMAIL = "root@platform.test"
PLATFORM_PASSWORD = "platform12345"
BASE_HOST = "guest.localhost"


def _caller(client, token: str):
    def call(method: str, path: str, body=None):
        kwargs = {"HTTP_HOST": BASE_HOST, "HTTP_AUTHORIZATION": f"Bearer {token}"}
        if body is not None:
            return getattr(client, method)(f"/api/v1/platform{path}", data=json.dumps(body), content_type="application/json", **kwargs)
        return getattr(client, method)(f"/api/v1/platform{path}", **kwargs)

    return call


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
    return _caller(client, token)


def _hotel(subdomain: str) -> Hotel:
    from apps.hotels.services.provisioning import provision_hotel

    return provision_hotel(subdomain=subdomain, name=subdomain.title(), admin_email=f"admin@{subdomain}.test").hotel


def _actions(hotel: Hotel, prefix: str) -> list[str]:
    with tenant_context(hotel):
        return list(AuditLog.objects.filter(hotel_id=hotel.pk, action__startswith=prefix).values_list("action", flat=True))


def test_bite_modules_write_was_and_became_for_each_changed_code(api):
    hotel = _hotel("jr-modules")
    api("put", f"/hotels/{hotel.pk}/modules/marketing", {"enabled": True})
    api("put", f"/hotels/{hotel.pk}/modules/room_control", {"enabled": True})
    api("put", f"/hotels/{hotel.pk}/modules/room_control", {"enabled": False})
    api("put", f"/hotels/{hotel.pk}/modules/marketing", {"enabled": True})
    with tenant_context(hotel):
        rows = list(AuditLog.objects.filter(action="platform.hotel.modules_set").order_by("created_at").values_list("payload", flat=True))
    assert rows == [
        {"module": "marketing", "from": False, "to": True},
        {"module": "room_control", "from": False, "to": True},
        {"module": "room_control", "from": True, "to": False},  # marketing не менялся — записи нет
    ]
    history = api("get", f"/hotels/{hotel.pk}/history?what=modules").json()
    assert history["items"][0]["changes"] == [{"field": "module:room_control", "from": True, "to": False}]
    assert history["items"][0]["object"] == {"kind": "module", "code": "room_control"}
    assert history["items"][0]["actor"]["role"] == "owner" and history["items"][0]["actor"]["name"]


def test_bite_entering_a_hotel_writes_one_record(api):
    hotel = _hotel("jr-enter")
    response = api("post", f"/hotels/{hotel.pk}/enter", {"reason": "разбор жалобы", "ttl_minutes": 15})
    assert response.status_code == 200, response.content
    with tenant_context(hotel):
        rows = list(AuditLog.objects.filter(hotel_id=hotel.pk).exclude(action__startswith="platform.hotel.created").values_list("action", "payload"))
    entries = [(a, p) for a, p in rows if a in ("impersonation.started", "platform.hotel.entered")]
    assert len(entries) == 1 and entries[0][0] == "impersonation.started"
    assert entries[0][1]["reason"] == "разбор жалобы" and entries[0][1]["ttl_minutes"] == 15


def test_bite_publishing_and_rolling_back_write_one_record_each(api, monkeypatch):
    """
    Запись о публикации и откате пишет сервис `publishing` (с актором), а
    ручка Control вторую рядом больше не кладёт. Сервис подменён: ручка,
    оставшись одна, не должна записать НИЧЕГО.
    """
    from types import SimpleNamespace

    from apps.grms.models import RoomType
    from apps.grms.services import publishing

    hotel = _hotel("jr-publish")
    with tenant_context(hotel):
        HotelModule.objects.update_or_create(code=HotelModule.Code.ROOM_CONTROL, defaults={"is_enabled": True})
        RoomType.objects.create(code="std", title={"ru": "Стандарт"})
    config = SimpleNamespace(version=3, published_at=timezone.now(), rolled_back_from=2)
    monkeypatch.setattr(publishing, "publish", lambda *a, **k: config)
    monkeypatch.setattr(publishing, "rollback", lambda *a, **k: config)
    assert api("post", f"/hotels/{hotel.pk}/grms/types/std/publish", {}).status_code == 200
    assert api("post", f"/hotels/{hotel.pk}/grms/types/std/rollback", {"to_version": 2}).status_code == 200
    assert _actions(hotel, "grms.") == []


def test_old_duplicates_are_collapsed_in_history_and_journal(api):
    hotel = _hotel("jr-dupes")
    with tenant_context(hotel):
        for action in ("grms.published", "grms.publish", "platform.hotel.entered", "impersonation.started"):
            AuditLog.record(action, actor_type=AuditLog.ActorType.PLATFORM, object_type="x", payload={"type": "std", "version": 1}, hotel_id=hotel.pk)
    actions = [row["action"] for row in api("get", f"/hotels/{hotel.pk}/history").json()["items"]]
    assert "grms.published" not in actions and "platform.hotel.entered" not in actions
    assert actions.count("grms.publish") == 1 and actions.count("impersonation.started") == 1
    feed = [row["action"] for row in api("get", "/audit?search=jr-dupes&limit=50").json()["items"]]
    assert "grms.published" not in feed and "platform.hotel.entered" not in feed


def test_bite_history_filters_on_the_server_and_pages_beyond_fifty(api):
    hotel = _hotel("jr-pages")
    old = timezone.now() - timedelta(days=20)
    with tenant_context(hotel):
        for n in range(120):
            row = AuditLog.record(
                "platform.hotel.updated", actor_type=AuditLog.ActorType.PLATFORM,
                object_type="hotel", hotel_id=hotel.pk,
                payload={"fields": ["timezone" if n % 2 else "city"], "changes": {("timezone" if n % 2 else "city"): {"from": f"a{n}", "to": f"b{n}"}}},
            )
            if n < 30:
                AuditLog.all_objects.filter(pk=row.pk).update(created_at=old)

    seen, cursor = [], ""
    while True:
        page = api("get", f"/hotels/{hotel.pk}/history?what=profile:timezone&limit=50&cursor={cursor}").json()
        seen += [row["id"] for row in page["items"]]
        cursor = page["next_cursor"] or ""
        if not cursor:
            break
    assert len(seen) == len(set(seen)) == 60  # все 60 записей пояса, страницами по 50, без повторов
    assert page["total"] == 60

    week = api("get", f"/hotels/{hotel.pk}/history?what=profile:timezone&period=week").json()
    assert week["total"] == 45  # 15 из 60 — двадцатидневной давности
    found = api("get", f"/hotels/{hotel.pk}/history?search=b77").json()
    assert found["total"] == 1 and found["items"][0]["changes"][0]["to"] == "b77"
    facets = {f["value"]: f["count"] for f in found["facets"]["what"]}
    assert facets["profile:timezone"] == 60 and facets["profile:city"] == 60


def test_journal_filters_by_who_group_and_support_view(api, client):
    hotel = _hotel("jr-journal")
    group = api("post", "/groups", {"title": "Журнал 62d", "hotel_ids": [str(hotel.pk)]}).json()
    api("post", f"/hotels/{hotel.pk}/enter", {"reason": "разбор", "ttl_minutes": 10})
    people = api("get", "/audit/people").json()
    me = next(p for p in people if p["email"] == PLATFORM_EMAIL)
    by_group = api("get", f"/audit?group_id={group['id']}&who={me['id']}").json()
    assert by_group["total"] >= 1 and all(row["subdomain"] == "jr-journal" for row in by_group["items"])
    support = api("get", f"/audit?view=support&group_id={group['id']}").json()
    assert [row["action"] for row in support["items"]] == ["impersonation.started"]
    assert support["items"][0]["actor_info"]["role"] == "owner"


def test_team_dictionaries_and_nodes_filter_on_the_server(api):
    from apps.hotels.models import OnPremNode
    from apps.hotels.services.onprem import register_node

    invited = api("post", "/team", {"email": "eyes-62d@platform.test", "role": "read_only"}).json()
    assert invited["member"]["role"] == "read_only"
    readers = api("get", "/team?role=read_only").json()["items"]
    assert readers and all(row["role"] == "read_only" for row in readers)
    assert all(row["totp_enabled"] is False for row in api("get", "/team?twofa=no").json()["items"])

    dictionary = api("get", "/dictionaries?kind=allergen&limit=500").json()
    assert dictionary["items"] and all(row["kind"] == "allergen" for row in dictionary["items"])
    assert dictionary["facets"]["kind"]["allergen"] == dictionary["total"]

    hotel = _hotel("jr-nodes")
    register_node(hotel, name="box-a", purpose="grms")
    node, _ = register_node(hotel, name="box-b", purpose="pms")
    with tenant_context(hotel):
        OnPremNode.objects.filter(pk=node.pk).update(last_seen_at=timezone.now())
    page = api("get", f"/hotels/{hotel.pk}/nodes?status=offline").json()
    assert [row["name"] for row in page["items"]] == ["box-a"]
    assert page["facets"]["status"] == {"offline": 1, "online": 1}
    assert [row["name"] for row in api("get", f"/hotels/{hotel.pk}/nodes?purpose=pms&search=box").json()["items"]] == ["box-b"]
