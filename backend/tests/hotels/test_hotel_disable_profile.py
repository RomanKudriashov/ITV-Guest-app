"""
ОТКЛЮЧЕНИЕ ОТЕЛЯ И ПРОФИЛЬ (партия 62-C).

Укусы:
* отключённый отель: гостю 423 и заглушка в бренде, вход персонала — отказ,
  команда номера не уходит, сессии гостей и персонала отозваны, Telegram и
  события молчат; причина — нигде, кроме Control;
* авто-включение по дате;
* массовое и групповое отключение — та же логика, причина обязательна;
* поддомен: старый адрес и старый QR ведут на новый; опасная правка без
  подтверждения — 409; только владелец;
* переводы названия не теряются; правка — в «Историю» было → стало.
"""

from __future__ import annotations

import json
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.core.context import tenant_context
from apps.hotels.models import Hotel, HotelSubdomainAlias
from apps.hotels.services.platform import activation
from tests.conftest import host_for

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

PLATFORM_EMAIL = "root@platform.test"
PLATFORM_PASSWORD = "platform12345"
BASE_HOST = "guest.localhost"
REASON = "Неоплата за октябрь — секрет-62c"
STAFF_PASSWORD = "staff-62c-pass"


def _login(client, email: str, password: str) -> str:
    return client.post(
        "/api/v1/platform/auth/login",
        data=json.dumps({"email": email, "password": password}),
        content_type="application/json",
        HTTP_HOST=BASE_HOST,
    ).json()["access"]


def _caller(client, token: str):
    def call(method: str, path: str, body=None):
        kwargs = {"HTTP_HOST": BASE_HOST, "HTTP_AUTHORIZATION": f"Bearer {token}"}
        if body is not None:
            return getattr(client, method)(
                f"/api/v1/platform{path}", data=json.dumps(body), content_type="application/json", **kwargs
            )
        return getattr(client, method)(f"/api/v1/platform{path}", **kwargs)

    return call


@pytest.fixture
def api(client):
    from apps.hotels.services.provisioning import ensure_platform_admin

    ensure_platform_admin(email=PLATFORM_EMAIL, password=PLATFORM_PASSWORD)
    return _caller(client, _login(client, PLATFORM_EMAIL, PLATFORM_PASSWORD))


@pytest.fixture
def support_api(client, api):
    invited = api("post", "/team", {"email": "support-62c@platform.test", "role": "support"}).json()
    return _caller(client, _login(client, "support-62c@platform.test", invited["password"]))


def _hotel(subdomain: str, **fields) -> Hotel:
    from apps.hotels.services.provisioning import provision_hotel

    hotel = provision_hotel(subdomain=subdomain, name=subdomain.title(), admin_email=f"admin@{subdomain}.test").hotel
    for key, value in fields.items():
        setattr(hotel, key, value)
    if fields:
        hotel.save()
    return hotel


def _room(hotel: Hotel, number: str = "101"):
    from apps.hotels.models import Room

    with tenant_context(hotel):
        return Room.objects.create(number=number)


def _guest(client, hotel: Hotel, number: str = "101") -> str:
    response = client.post(
        "/api/guest/session",
        data={"room_number": number, "language": "ru"},
        content_type="application/json",
        HTTP_HOST=host_for(hotel),
    )
    assert response.status_code == 200, response.content
    return response.json()["token"]


def _staff_login(client, hotel: Hotel):
    from apps.accounts.models import User

    with tenant_context(hotel):
        admin = User.objects.get(is_hotel_admin=True)
        admin.set_password(STAFF_PASSWORD)
        admin.save()
    return client.post(
        "/api/staff/auth/login",
        data={"email": admin.email, "password": STAFF_PASSWORD},
        content_type="application/json",
        HTTP_HOST=host_for(hotel),
    )


# --- Отключение -----------------------------------------------------------------


# Журнал и имена читаются платформенным подключением: оно видит только записанное.
@pytest.mark.django_db(transaction=True, databases=["default", "platform"])
def test_disable_needs_a_reason_and_control_sees_who_when_and_why(api):
    hotel = _hotel("dis-reason")
    response = api("post", f"/hotels/{hotel.pk}/disable", {"reason": "  "})
    assert response.status_code == 422 and response.json()["code"] == "reason_required"

    tomorrow = (timezone.now() + timedelta(days=2)).date()
    profile = api("post", f"/hotels/{hotel.pk}/disable", {"reason": REASON, "enable_on": tomorrow.isoformat()}).json()
    assert profile["is_active"] is False
    assert profile["disabled"]["reason"] == REASON
    assert profile["disabled"]["by"] and profile["disabled"]["at"]
    assert profile["disabled"]["enable_on"] == tomorrow.isoformat()

    activity = api("get", f"/hotels/{hotel.pk}/activity").json()
    entry = next(row for row in activity if row["action"] == "platform.hotel.deactivated")
    assert entry["payload"]["reason"] == REASON  # журнал Control — с причиной

    enabled = api("post", f"/hotels/{hotel.pk}/enable", {}).json()
    assert enabled["is_active"] is True and enabled["disabled"] is None


@pytest.mark.django_db(transaction=True, databases=["default", "platform"])
def test_bite_disabled_hotel_closes_guests_and_staff_and_never_shows_the_reason(client, api):
    from apps.accounts.models import GuestSession, StaffSession
    from apps.core.context import platform_scope

    hotel = _hotel("dis-gate")
    _room(hotel)
    token = _guest(client, hotel)
    assert _staff_login(client, hotel).status_code == 200

    api("post", f"/hotels/{hotel.pk}/disable", {"reason": REASON})

    with platform_scope():
        assert not GuestSession.all_objects.using("platform").filter(hotel_id=hotel.pk, revoked_at__isnull=True).exists()
        assert not StaffSession.all_objects.using("platform").filter(hotel_id=hotel.pk, revoked_at__isnull=True).exists()

    bodies = []
    # Гость: витрина отвечает 423 без причины.
    guest = client.get("/api/v1/guest/home", HTTP_HOST=host_for(hotel), HTTP_AUTHORIZATION=f"Bearer {token}")
    assert guest.status_code == 423 and guest.json() == {"detail": "Отель временно не принимает заказы", "code": "hotel_disabled"}
    bodies.append(guest.content)
    fresh = client.post("/api/guest/session", data={"room_number": "101"}, content_type="application/json", HTTP_HOST=host_for(hotel))
    assert fresh.status_code == 423
    bodies.append(fresh.content)

    # Заглушка — по ручке состояния: имя и бренд отеля, без причины.
    status = client.get("/api/v1/hotel/status", HTTP_HOST=host_for(hotel))
    assert status.status_code == 200
    assert status.json()["state"] == "disabled" and status.json()["name"] and "theme" in status.json()
    bodies.append(status.content)

    # Персонал: форма видна, вход — «Вход недоступен».
    login = _staff_login(client, hotel)
    assert login.status_code == 423 and login.json()["detail"] == "Вход недоступен"
    bodies.append(login.content)
    cms = client.get("/api/v1/cms/bootstrap", HTTP_HOST=host_for(hotel))
    assert cms.status_code == 423
    bodies.append(cms.content)

    for body in bodies:
        assert REASON.encode() not in body and "Неоплата".encode() not in body


def test_bite_a_room_command_is_not_sent_for_a_disabled_hotel(monkeypatch):
    from apps.grms.services import commands
    from apps.grms.transport import transport

    hotel = _hotel("dis-cmd")
    sent = []
    monkeypatch.setattr(transport, "send", lambda *a, **k: sent.append(a) or {"raw_body": "", "error": None})
    activation.disable(hotel, reason=REASON)
    result = commands.send_command(hotel, device="Dev", channel="Light", value=1)
    assert result == {"result": "failed", "value": None, "error": "HOTEL_DISABLED"}
    assert sent == []  # до коннектора не дошло ничего


def test_bite_a_disabled_hotel_is_silent_in_events_and_telegram(settings):
    from apps.notifications.services import events, personal

    settings.NOTIFICATIONS_ENABLED = True
    hotel = _hotel("dis-quiet", telegram_enabled=True)
    assert personal.hotel_allows(hotel.pk)
    with tenant_context(hotel):
        assert events.notify("order.cancelled", {}, dedupe_key="62c-before") is not None  # включённый — пишет
    activation.disable(hotel, reason=REASON)
    assert not personal.hotel_allows(hotel.pk)  # бот и личные каналы молчат
    with tenant_context(hotel):
        assert events.notify("order.cancelled", {}, dedupe_key="62c-after") is None


def test_bite_auto_enable_on_the_date():
    from apps.core.models import AuditLog
    from apps.core.models_scheduler import ScheduledJob
    from apps.core.services import scheduler

    hotel = _hotel("dis-auto")
    day = (timezone.now() + timedelta(days=3)).date()
    activation.disable(hotel, reason=REASON, enable_on=day)
    with tenant_context(hotel):
        job = ScheduledJob.objects.get(kind=activation.JOB_KIND, status=ScheduledJob.Status.PENDING)
    assert job.payload == {"enable_on": day.isoformat()}

    scheduler.tick(now=timezone.now() + timedelta(days=1))
    hotel.refresh_from_db()
    assert not hotel.is_active  # срок не пришёл

    scheduler.tick(now=timezone.now() + timedelta(days=4))
    hotel.refresh_from_db()
    assert hotel.is_active and hotel.enable_on is None and hotel.disabled_reason == ""
    with tenant_context(hotel):
        assert AuditLog.objects.filter(action="platform.hotel.activated", payload__auto=True).exists()


def test_a_changed_date_replaces_the_job_and_a_manual_enable_cancels_it():
    from apps.core.models_scheduler import ScheduledJob

    hotel = _hotel("dis-resched")
    activation.disable(hotel, reason=REASON, enable_on=(timezone.now() + timedelta(days=3)).date())
    activation.disable(hotel, reason=REASON, enable_on=(timezone.now() + timedelta(days=5)).date())
    with tenant_context(hotel):
        assert ScheduledJob.objects.filter(kind=activation.JOB_KIND, status=ScheduledJob.Status.PENDING).count() == 1
    activation.enable(hotel)
    with tenant_context(hotel):
        assert not ScheduledJob.objects.filter(kind=activation.JOB_KIND, status=ScheduledJob.Status.PENDING).exists()


def test_bulk_and_group_disabling_use_the_same_logic_with_a_reason(api):
    one, two = _hotel("dis-bulk-a"), _hotel("dis-bulk-b")
    refused = api("post", "/fleet/bulk", {"hotel_ids": [str(one.pk)], "is_active": False})
    assert refused.status_code == 422 and refused.json()["code"] == "reason_required"
    done = api("post", "/fleet/bulk", {"hotel_ids": [str(one.pk)], "is_active": False, "reason": REASON}).json()
    assert done["changed"] == 1
    one.refresh_from_db()
    assert one.disabled_reason == REASON and one.disabled_at is not None

    group = api("post", "/groups", {"title": "Отключение 62c", "hotel_ids": [str(two.pk)]}).json()
    api("post", f"/groups/{group['id']}/actions", {"kind": "disable", "hotel_ids": [str(two.pk)], "reason": REASON})
    two.refresh_from_db()
    assert not two.is_active and two.disabled_reason == REASON


# --- Профиль --------------------------------------------------------------------


# Журнал и имена читаются платформенным подключением: оно видит только записанное.
@pytest.mark.django_db(transaction=True, databases=["default", "platform"])
def test_bite_name_translations_survive_a_one_language_edit(api):
    hotel = _hotel("prof-names")
    hotel.name = {hotel.default_language: "Кристалл", "zh": "水晶"}
    hotel.save()
    lang = hotel.default_language

    api("patch", f"/hotels/{hotel.pk}", {"name": {"en": "Crystal"}})
    hotel.refresh_from_db()
    assert hotel.name == {lang: "Кристалл", "zh": "水晶", "en": "Crystal"}

    api("patch", f"/hotels/{hotel.pk}", {"name": "Кристалл 2"})  # строкой — основной язык
    hotel.refresh_from_db()
    assert hotel.name == {lang: "Кристалл 2", "zh": "水晶", "en": "Crystal"}

    api("patch", f"/hotels/{hotel.pk}", {"name": {"zh": ""}})  # пустое — убрать перевод
    hotel.refresh_from_db()
    assert "zh" not in hotel.name
    refused = api("patch", f"/hotels/{hotel.pk}", {"name": {lang: ""}})
    assert refused.status_code == 422

    history = api("get", f"/hotels/{hotel.pk}/activity").json()
    change = next(r for r in history if r["action"] == "platform.hotel.updated")["payload"]["changes"]["name"]
    assert change["from"] == {lang: "Кристалл 2", "en": "Crystal", "zh": "水晶"} and "zh" not in change["to"]


def test_bite_a_dangerous_edit_without_confirmation_is_409_with_consequences(api):
    hotel = _hotel("prof-danger")
    response = api("patch", f"/hotels/{hotel.pk}", {"timezone": "Europe/Kaliningrad", "city": {"ru": "Калининград"}})
    assert response.status_code == 409
    body = response.json()
    assert body["code"] == "needs_confirmation" and body["fields"] == ["timezone"]
    assert body["consequences"]["timezone"][0]["code"] == "hours_shift"
    hotel.refresh_from_db()
    assert hotel.timezone == "Europe/Moscow" and not hotel.city  # ничего не записано

    ok = api("patch", f"/hotels/{hotel.pk}", {"timezone": "Europe/Kaliningrad", "confirm": ["timezone"]})
    assert ok.status_code == 200 and ok.json()["timezone"] == "Europe/Kaliningrad"
    # Неизменённое опасное поле подтверждения не просит.
    same = api("patch", f"/hotels/{hotel.pk}", {"timezone": "Europe/Kaliningrad", "currency": "RUB"})
    assert same.status_code == 200


def test_subdomain_and_domain_are_owner_only(api, support_api):
    hotel = _hotel("prof-owner")
    for body in ({"subdomain": "prof-owner-2", "confirm": ["subdomain"]}, {"custom_domain": "menu.example.com"}):
        response = support_api("patch", f"/hotels/{hotel.pk}", body)
        assert response.status_code == 403 and response.json()["code"] == "owner_only"
    assert support_api("patch", f"/hotels/{hotel.pk}", {"city": {"ru": "Тверь"}}).status_code == 200


def test_bite_a_new_subdomain_redirects_the_old_address_and_old_qr(client, api):
    hotel = _hotel("prof-old")
    _room(hotel, "305")
    asked = api("patch", f"/hotels/{hotel.pk}", {"subdomain": "prof-new"})
    assert asked.status_code == 409 and asked.json()["fields"] == ["subdomain"]
    moved = api("patch", f"/hotels/{hotel.pk}", {"subdomain": "prof-new", "confirm": ["subdomain"]}).json()
    assert moved["subdomain"] == "prof-new" and moved["aliases"][0]["old"] == "prof-old"

    # Приложение по старому адресу (в т.ч. QR /r/305) спрашивает состояние —
    # и уходит на новый адрес с тем же путём.
    status = client.get("/api/v1/hotel/status", HTTP_HOST="prof-old.guest.localhost")
    assert status.status_code == 200
    assert status.json() == {"state": "moved", "location": "http://prof-new.guest.localhost", "code": "hotel_moved"}
    gone = client.post("/api/guest/session", data={"room_number": "305"}, content_type="application/json", HTTP_HOST="prof-old.guest.localhost")
    assert gone.status_code == 410 and gone.json()["location"] == "http://prof-new.guest.localhost"
    assert client.post("/api/guest/session", data={"room_number": "305"}, content_type="application/json", HTTP_HOST="prof-new.guest.localhost").status_code == 200

    # Пока перенаправление живо, старое имя другому отелю не достаётся.
    from apps.hotels.services.hotel_fields import subdomain_status

    assert subdomain_status("prof-old")["code"] == "subdomain_alias"

    # Снимается только вручную — и тогда старый адрес больше не отвечает.
    assert api("delete", f"/hotels/{hotel.pk}/aliases/prof-old").status_code == 200
    assert client.get("/api/v1/hotel/status", HTTP_HOST="prof-old.guest.localhost").status_code == 404
    assert not HotelSubdomainAlias.objects.filter(old="prof-old").exists()


def test_deleting_a_hotel_frees_its_old_subdomains(api):
    hotel = _hotel("prof-gone")
    api("patch", f"/hotels/{hotel.pk}", {"subdomain": "prof-gone-2", "confirm": ["subdomain"]})
    assert HotelSubdomainAlias.objects.filter(old="prof-gone").exists()
    hotel.refresh_from_db()
    hotel.delete()
    assert not HotelSubdomainAlias.all_objects.filter(old="prof-gone").exists()


def test_returning_to_the_old_subdomain_drops_its_redirect(api):
    hotel = _hotel("prof-back")
    api("patch", f"/hotels/{hotel.pk}", {"subdomain": "prof-back-2", "confirm": ["subdomain"]})
    api("patch", f"/hotels/{hotel.pk}", {"subdomain": "prof-back", "confirm": ["subdomain"]})
    assert list(HotelSubdomainAlias.objects.filter(hotel=hotel).values_list("old", flat=True)) == ["prof-back-2"]


def test_custom_domain_check_and_uniqueness(api, monkeypatch):
    from apps.hotels.services.platform import profile_edit

    one, two = _hotel("prof-dom-a"), _hotel("prof-dom-b")
    assert api("patch", f"/hotels/{one.pk}", {"custom_domain": "https://Menu.Example.com/"}).json()["custom_domain"] == "menu.example.com"
    taken = api("patch", f"/hotels/{two.pk}", {"custom_domain": "menu.example.com"})
    assert taken.status_code == 409 and taken.json()["code"] == "domain_taken"
    assert api("patch", f"/hotels/{two.pk}", {"custom_domain": "x.guest.localhost"}).json()["code"] == "domain_platform"

    monkeypatch.setattr(profile_edit, "_addresses", lambda host: ["1.2.3.4"] if host != "other.example.org" else ["9.9.9.9"])
    assert api("get", f"/hotels/{one.pk}/domain-check?domain=menu.example.com").json()["points_here"] is True
    assert api("get", f"/hotels/{one.pk}/domain-check?domain=other.example.org").json()["points_here"] is False


# Журнал и имена читаются платформенным подключением: оно видит только записанное.
@pytest.mark.django_db(transaction=True, databases=["default", "platform"])
def test_moving_a_hotel_between_groups_lands_in_its_history(api):
    hotel = _hotel("prof-group")
    group = api("post", "/groups", {"title": "Профиль 62c"}).json()
    api("post", "/groups/move", {"hotel_ids": [str(hotel.pk)], "group_id": group["id"]})
    history = api("get", f"/hotels/{hotel.pk}/activity").json()
    change = next(r for r in history if r["action"] == "platform.hotel.updated")["payload"]["changes"]["group"]
    assert change == {"from": "", "to": "Профиль 62c"}


# Журнал и имена читаются платформенным подключением: оно видит только записанное.
@pytest.mark.django_db(transaction=True, databases=["default", "platform"])
def test_certificate_names_keep_disabled_hotels_and_old_subdomains():
    from apps.hotels.management.commands.tls_names import certificate_names

    hotel = _hotel("tls-dis", origin="live")
    activation.disable(hotel, reason=REASON)
    HotelSubdomainAlias.objects.create(old="tls-old", hotel=hotel)
    names = certificate_names()
    assert "tls-dis.guest.localhost" in names and "tls-old.guest.localhost" in names
