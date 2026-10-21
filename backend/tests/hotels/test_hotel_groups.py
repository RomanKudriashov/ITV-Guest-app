"""
ГРУППЫ ОТЕЛЕЙ — отели одного владельца (партия 62-A1).

* отель — максимум в одной группе: добавить в другую значит перенести;
* удаление группы не трогает отели — они уходят в «без группы»;
* реестр считает живые строки (номера, персонал), а не мягко удалённые;
* поиск реестра находит отель по названию группы и по городу;
* массовое действие и фильтр реестра считают состав группы одним кодом.
"""

from __future__ import annotations

import json

import pytest

from apps.hotels.models import Hotel, HotelGroup
from apps.hotels.services.platform import groups as groups_svc

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

PLATFORM_EMAIL = "root@platform.test"
PLATFORM_PASSWORD = "platform12345"
BASE_HOST = "guest.localhost"


@pytest.fixture
def api(client):
    """NaviRoom Control: токен владельца плюс адресация корневым хостом."""
    from apps.hotels.services.provisioning import ensure_platform_admin

    ensure_platform_admin(email=PLATFORM_EMAIL, password=PLATFORM_PASSWORD)
    token = client.post(
        "/api/v1/platform/auth/login",
        data=json.dumps({"email": PLATFORM_EMAIL, "password": PLATFORM_PASSWORD}),
        content_type="application/json",
        HTTP_HOST=BASE_HOST,
    ).json()["access"]

    def call(method: str, path: str, body=None):
        kwargs = {
            "HTTP_HOST": BASE_HOST,
            "HTTP_AUTHORIZATION": f"Bearer {token}",
        }
        if body is not None:
            return getattr(client, method)(
                f"/api/v1/platform{path}",
                data=json.dumps(body),
                content_type="application/json",
                **kwargs,
            )
        return getattr(client, method)(f"/api/v1/platform{path}", **kwargs)

    return call


def _hotel(subdomain: str, *, city: str = "", **fields) -> Hotel:
    from apps.hotels.services.provisioning import provision_hotel

    hotel = provision_hotel(
        subdomain=subdomain,
        name=subdomain.title(),
        admin_email=f"admin@{subdomain}.test",
    ).hotel
    if city:
        hotel.city = {"ru": city}
    for key, value in fields.items():
        setattr(hotel, key, value)
    hotel.save()
    return hotel


def _group(api, title: str, hotels: list = (), **extra) -> dict:
    response = api("post", "/groups", {"title": title, "hotel_ids": [str(h.pk) for h in hotels], **extra})
    assert response.status_code == 201, response.content
    return response.json()


def _view(api, query: str = "") -> dict:
    response = api("get", f"/fleet?layout=groups&origin=all{query}")
    assert response.status_code == 200, response.content
    return response.json()


# --- Один владелец ------------------------------------------------------------


def test_bite_a_hotel_lives_in_one_group_only(api):
    """УКУС. Отель, добавленный во вторую группу, уходит из первой — сам."""
    hotel = _hotel("onegroup")
    first = _group(api, "Первая", [hotel])
    second = _group(api, "Вторая")

    moved = api("post", f"/groups/{second['id']}/members", {"hotel_ids": [str(hotel.pk)]})
    assert moved.status_code == 200, moved.content
    [move] = moved.json()["moves"]
    assert (move["hotel"], move["from"], move["to"]) == ("onegroup", "Первая", "Вторая")
    assert (move["from_id"], move["to_id"]) == (first["id"], second["id"])

    assert [g["title"] for g in groups_svc.groups_of(hotel)] == ["Вторая"]
    assert api("get", f"/groups/{first['id']}/members").json()["members"] == []


def test_the_database_refuses_a_second_live_membership():
    """Уникальность держит и база: обойти сервис и положить отель в две группы нельзя."""
    from django.db import IntegrityError, transaction

    from apps.hotels.models import HotelGroupMember

    hotel = _hotel("dbguard")
    one = HotelGroup.objects.create(code="db-one", title="Раз")
    two = HotelGroup.objects.create(code="db-two", title="Два")
    HotelGroupMember.objects.create(group=one, hotel=hotel)
    with pytest.raises(IntegrityError), transaction.atomic():
        HotelGroupMember.objects.create(group=two, hotel=hotel)


def test_a_hotel_can_be_moved_out_of_any_group(api):
    hotel = _hotel("loose")
    _group(api, "Временная", [hotel])
    response = api("post", "/groups/move", {"hotel_ids": [str(hotel.pk)], "group_id": None})
    assert response.status_code == 200, response.content
    assert response.json()["moved"] == 1
    assert groups_svc.groups_of(hotel) == []


def test_a_group_is_created_by_title_with_hotels_and_a_colour(api):
    """Код человек не вводит: группа заводится по названию, сразу с отелями."""
    hotel = _hotel("withgroup")
    created = _group(api, "Отели Метрополь", [hotel], description="Один владелец", color="gold")
    assert created["code"] and created["title"] == "Отели Метрополь"
    assert created["color"] == "gold" and created["description"] == "Один владелец"
    assert created["size"] == 1

    twin = api("post", "/groups", {"title": "отели метрополь"})
    assert twin.status_code == 422 and twin.json()["code"] == "title_taken"
    assert api("post", "/groups", {"title": "  "}).json()["code"] == "title_required"
    assert api("post", "/groups", {"title": "Цвет", "color": "pink"}).json()["code"] == "group_color"


def test_a_group_is_renamed_and_the_journal_keeps_before_and_after(api):
    from apps.core.models import AuditLog

    group = _group(api, "Старое имя")
    response = api("patch", f"/groups/{group['id']}", {"title": "Новое имя", "note": "Звонить Ивану"})
    assert response.status_code == 200, response.content
    assert response.json()["title"] == "Новое имя"
    from apps.core.context import platform_scope

    with platform_scope():
        entry = AuditLog.all_objects.using("platform").filter(action="platform.group.updated").latest("created_at")
    assert entry.payload["changes"]["title"] == {"from": "Старое имя", "to": "Новое имя"}


# --- Удаление ------------------------------------------------------------------


def test_bite_deleting_a_group_leaves_its_hotels_alone(api):
    """УКУС. Удалили группу — отели живы, включены и без группы; подтверждение — названием."""
    one, two = _hotel("keep-one"), _hotel("keep-two")
    group = _group(api, "Удаляемая", [one, two])

    refused = api("delete", f"/groups/{group['id']}?confirm_title=Не%20то")
    assert refused.status_code == 422 and refused.json()["code"] == "group_confirm"

    gone = api("delete", f"/groups/{group['id']}?confirm_title=%D0%A3%D0%B4%D0%B0%D0%BB%D1%8F%D0%B5%D0%BC%D0%B0%D1%8F")
    assert gone.status_code == 200, gone.content
    assert sorted(gone.json()["released"]) == ["keep-one", "keep-two"]

    for hotel in (one, two):
        hotel.refresh_from_db()
        assert hotel.deleted_at is None and hotel.is_active
        assert groups_svc.groups_of(hotel) == []
    assert not HotelGroup.all_objects.filter(pk=group["id"]).exists()
    loose = {row["subdomain"] for row in _view(api)["ungrouped"]["items"]}
    assert {"keep-one", "keep-two"} <= loose


def test_a_deleted_group_title_and_code_can_be_used_again(api):
    first = _group(api, "Снова")
    api("delete", f"/groups/{first['id']}?confirm_title=%D0%A1%D0%BD%D0%BE%D0%B2%D0%B0")
    second = api("post", "/groups", {"title": "Снова", "code": first["code"]})
    assert second.status_code == 201, second.content


def test_a_code_held_by_a_softly_deleted_group_is_freed(api):
    """Группа, удалённая мягко прежним кодом, не держит свой код вечно."""
    stale = HotelGroup.objects.create(code="stale", title="Старая")
    stale.delete()  # мягко — как удалял прежний код

    created = api("post", "/groups", {"code": "stale", "title": "Новая"})
    assert created.status_code == 201, created.content


def test_a_hotel_removed_from_a_group_can_be_added_back(api):
    """Отель убрали из группы — его можно вернуть, а не 409."""
    hotel = _hotel("backagain")
    group = _group(api, "Back", [hotel])
    assert api("delete", f"/groups/{group['id']}/members/{hotel.pk}").status_code == 200

    again = api("post", f"/groups/{group['id']}/members", {"hotel_ids": [str(hotel.pk)]})
    assert again.status_code == 200, again.content
    assert [g["title"] for g in groups_svc.groups_of(hotel)] == ["Back"]


def test_a_membership_softly_removed_by_the_old_code_does_not_block(api):
    from apps.hotels.models import HotelGroupMember

    hotel = _hotel("oldpair")
    group = _group(api, "Old", [hotel])
    HotelGroupMember.objects.filter(group_id=group["id"], hotel=hotel).delete()  # мягко

    again = api("post", f"/groups/{group['id']}/members", {"hotel_ids": [str(hotel.pk)]})
    assert again.status_code == 200, again.content


# --- Реестр -------------------------------------------------------------------


@pytest.mark.django_db(transaction=True, databases=["default", "platform"])
def test_bite_the_fleet_counts_live_rooms_not_deleted_ones(api):
    """
    УКУС. «Кристалл» показывал 56133 номера вместо 9: считались мягко удалённые.

    Транзакционный: счётчики реестра читает платформенное подключение, и
    незакоммиченные номера теста ему не видны.
    """
    from apps.core.context import tenant_context
    from apps.hotels.models import Room

    hotel = _hotel("liverooms")
    with tenant_context(hotel):
        rooms = [Room.objects.create(number=str(100 + n), floor="1") for n in range(5)]
        for room in rooms[:3]:
            room.delete()  # мягко

    row = next(r for r in api("get", "/fleet?origin=all&search=liverooms").json()["items"])
    assert row["counts"]["rooms"] == 2, row["counts"]
    view = next(r for r in _view(api, "&search=liverooms")["ungrouped"]["items"])
    assert view["counts"]["rooms"] == 2


def test_bite_search_finds_a_hotel_by_its_group_and_by_its_city(api):
    hotel = _hotel("searchme", city="Кострома")
    _hotel("bystander", city="Пермь")
    _group(api, "Северная корона", [hotel])

    by_group = _view(api, "&search=%D0%BA%D0%BE%D1%80%D0%BE%D0%BD")  # «корон»
    found = [r["subdomain"] for g in by_group["groups"] for r in g["items"]]
    assert found == ["searchme"]
    assert [g["title"] for g in by_group["groups"]] == ["Северная корона"]

    by_city = api("get", "/fleet?layout=list&origin=all&search=%D0%BA%D0%BE%D1%81%D1%82%D1%80").json()  # «костр»
    assert [r["subdomain"] for r in by_city["items"]] == ["searchme"]


def test_the_grouped_view_summarises_each_group_and_the_loose_hotels(api):
    one, two = _hotel("sum-one"), _hotel("sum-two")
    _hotel("sum-loose")
    group = _group(api, "Сводная", [one, two])
    view = _view(api)
    block = next(g for g in view["groups"] if g["id"] == group["id"])
    assert block["summary"]["hotels"] == 2
    assert block["summary"]["problems"] == 0
    assert {r["subdomain"] for r in block["items"]} == {"sum-one", "sum-two"}
    assert all(r["group"]["title"] == "Сводная" for r in block["items"])
    assert "sum-loose" in {r["subdomain"] for r in view["ungrouped"]["items"]}


def test_view_filters_combine_and_facets_count_with_the_other_filters(api):
    on = _hotel("flt-on")
    off = _hotel("flt-off")
    off.is_active = False
    off.save()
    group = _group(api, "Фильтры", [on, off])

    view = _view(api, f"&group={group['id']}&state=disabled")
    rows = [r["subdomain"] for g in view["groups"] for r in g["items"]] + [r["subdomain"] for r in view["ungrouped"]["items"]]
    assert rows == ["flt-off"]
    # Счётчик состояния — при выбранной группе, без учёта самого состояния.
    assert view["facets"]["state"] == {"ready": 1, "disabled": 1}

    none = _view(api, "&group=none&search=flt-")
    assert none["total"] == 0


def test_the_bulk_action_is_addressed_by_a_group(api):
    """Массовое выключение адресуется группой — тем же составом, что видит экран."""
    one, two = _hotel("bulk-one"), _hotel("bulk-two")
    group = _group(api, "Массовая", [one, two])

    response = api("post", "/fleet/bulk", {"group_id": group["id"], "is_active": False})
    assert response.status_code == 200, response.content
    assert response.json()["changed"] == 2

    listed = api("get", f"/fleet?layout=list&origin=all&group={group['id']}").json()
    assert listed["total"] == len(groups_svc.hotel_ids(HotelGroup.objects.get(pk=group["id"]))) == 2


def test_a_missing_group_shows_nothing_rather_than_everything(api):
    _hotel("ghost")
    fleet = api("get", "/fleet?group=00000000-0000-0000-0000-000000000000").json()
    assert fleet["total"] == 0
    assert _view(api, "&group=00000000-0000-0000-0000-000000000000")["total"] == 0


# --- Партия 62-A2: действия, умолчания, история ---------------------------------


def _modules(hotel) -> set:
    from apps.hotels.module_registry import enabled_module_codes

    return enabled_module_codes(hotel)


def test_bite_a_group_action_changes_exactly_the_shown_hotels(api):
    """
    УКУС. Показ «что изменится» и выполнение — один план. Меняются только
    отели из показа, которым действие что-то меняет; отель вне группы,
    подсунутый в запрос, не меняется.
    """
    from apps.hotels.module_registry import set_modules

    one, two, three, outsider = _hotel("act-one"), _hotel("act-two"), _hotel("act-three"), _hotel("act-out")
    set_modules(two, [{"code": "marketing", "is_enabled": True}])
    group = _group(api, "Действия", [one, two, three])

    preview = api("post", f"/groups/{group['id']}/actions/preview", {"kind": "module_on", "module": "marketing"}).json()
    plan = {row["subdomain"]: row["change"] for row in preview["items"]}
    assert plan == {"act-one": True, "act-two": False, "act-three": True}
    assert preview["changes"] == 2

    # Человек видел показ без «act-three» (например, показ был до его добавления).
    shown = [row["hotel_id"] for row in preview["items"] if row["subdomain"] != "act-three"] + [str(outsider.pk)]
    done = api("post", f"/groups/{group['id']}/actions", {"kind": "module_on", "module": "marketing", "hotel_ids": shown})
    assert done.status_code == 200, done.content
    assert [row["subdomain"] for row in done.json()["changed"]] == ["act-one"]
    assert "marketing" in _modules(one)
    assert "marketing" not in _modules(three), "изменили отель, которого не было в показе"
    assert "marketing" not in _modules(outsider), "изменили отель вне группы"


def test_disabling_a_whole_group_needs_a_reason_and_enabling_brings_back(api):
    one, two = _hotel("dis-one"), _hotel("dis-two")
    group = _group(api, "Отключаемая", [one, two])
    ids = [str(one.pk), str(two.pk)]

    refused = api("post", f"/groups/{group['id']}/actions", {"kind": "disable", "hotel_ids": ids})
    assert refused.status_code == 422 and refused.json()["code"] == "reason_required"

    done = api("post", f"/groups/{group['id']}/actions", {"kind": "disable", "hotel_ids": ids, "reason": "неоплата"})
    assert len(done.json()["changed"]) == 2
    for hotel in (one, two):
        hotel.refresh_from_db()
        assert hotel.is_active is False

    back = api("post", f"/groups/{group['id']}/actions", {"kind": "enable", "hotel_ids": ids})
    assert len(back.json()["changed"]) == 2
    one.refresh_from_db()
    assert one.is_active is True


def test_bite_defaults_apply_on_adding_and_leave_existing_hotels_alone(api):
    """
    УКУС. Правило умолчаний включает модули ПРИШЕДШЕМУ отелю и не трогает тех,
    кто уже в группе; выключенное правило не делает ничего.
    """
    old, newcomer, late = _hotel("def-old"), _hotel("def-new"), _hotel("def-late")
    group = _group(api, "Умолчания", [old])

    saved = api("put", f"/groups/{group['id']}/defaults", {"enabled": True, "modules": ["marketing"]})
    assert saved.status_code == 200 and saved.json()["auto_modules"] == ["marketing"]
    assert "marketing" not in _modules(old), "правило тронуло отель, который уже был в группе"

    moved = api("post", f"/groups/{group['id']}/members", {"hotel_ids": [str(newcomer.pk)]}).json()
    assert moved["moves"][0]["modules_enabled"] == ["marketing"]
    assert "marketing" in _modules(newcomer)

    api("put", f"/groups/{group['id']}/defaults", {"enabled": False, "modules": ["marketing"]})
    api("post", f"/groups/{group['id']}/members", {"hotel_ids": [str(late.pk)]})
    assert "marketing" not in _modules(late), "выключенное правило сработало"


def test_bite_the_history_keeps_before_and_after_for_both_groups(api):
    """
    УКУС. История группы: переименование «было → стало», умолчания, действие;
    переезд отеля виден в истории ОБЕИХ групп — откуда и куда.
    """
    hotel = _hotel("hist-hotel")
    source = _group(api, "Источник", [hotel])
    target = _group(api, "Приёмник")

    api("patch", f"/groups/{target['id']}", {"title": "Приёмник 2"})
    api("put", f"/groups/{target['id']}/defaults", {"enabled": True, "modules": ["marketing"]})
    api("post", f"/groups/{target['id']}/members", {"hotel_ids": [str(hotel.pk)]})

    target_history = api("get", f"/groups/{target['id']}/history").json()["items"]
    actions = [row["action"] for row in target_history]
    assert actions[:3] == ["platform.group.hotels_moved", "platform.group.defaults_set", "platform.group.updated"]
    renamed = next(r for r in target_history if r["action"] == "platform.group.updated")
    assert renamed["payload"]["changes"]["title"] == {"from": "Приёмник", "to": "Приёмник 2"}
    assert target_history[0]["actor"], "в истории не видно, кто сделал"
    move = target_history[0]["payload"]["moves"][0]
    assert (move["from"], move["to"]) == ("Источник", "Приёмник 2")

    source_actions = [row["action"] for row in api("get", f"/groups/{source['id']}/history").json()["items"]]
    assert "platform.group.hotels_moved" in source_actions, "в истории группы-источника не видно ухода отеля"


@pytest.mark.django_db(transaction=True, databases=["default", "platform"])
def test_the_group_page_shows_summary_hotels_and_modules(api):
    """Транзакционный: модули отелей считает платформенное подключение."""
    from apps.hotels.module_registry import set_modules

    one, two = _hotel("page-one"), _hotel("page-two")
    set_modules(one, [{"code": "marketing", "is_enabled": True}])
    group = _group(api, "Страница", [one, two], description="Про группу")
    page = api("get", f"/groups/{group['id']}").json()
    assert page["description"] == "Про группу"
    assert page["summary"]["hotels"] == 2
    assert page["modules"] == {"marketing": 1}
    assert {r["subdomain"] for r in page["items"]} == {"page-one", "page-two"}
