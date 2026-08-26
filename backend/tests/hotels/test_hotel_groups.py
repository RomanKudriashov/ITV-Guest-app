"""
ГРУППЫ ОТЕЛЕЙ: адрес для массовых действий платформы.

Проверяется то, ради чего группы и заводятся:

* отель лежит в НЕСКОЛЬКИХ группах разом — сеть и город не вытесняют друг друга;
* группа-правило ПЕРЕСЧИТЫВАЕТСЯ, а не помнит старый состав;
* массовое действие адресуется группой, и адресуется тем же кодом, который
  показал число на экране;
* правилу состав руками не задают.
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
    """Консоль платформы: токен владельца плюс адресация корневым хостом."""
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


def test_a_hotel_lives_in_several_groups_at_once(api):
    """
    Сеть, город и кампания — три независимых разреза одного отеля. Одна группа
    на отель означала бы, что кампания вытесняет сеть.
    """
    hotel = _hotel("multi", city="Москва")

    ids = []
    for code, kind in (("net-a", "network"), ("msk", "city"), ("autumn", "campaign")):
        created = api("post", "/groups", {"code": code, "title": code, "kind": kind, "mode": "list"})
        assert created.status_code == 201, created.content
        group_id = created.json()["id"]
        ids.append(group_id)
        added = api("post", f"/groups/{group_id}/members", {"hotel_ids": [str(hotel.pk)]})
        assert added.status_code == 200, added.content

    inside = groups_svc.groups_of(hotel)
    assert {row["code"] for row in inside} == {"net-a", "msk", "autumn"}


def test_a_rule_group_is_recomputed_and_does_not_remember(api):
    """
    УКУС. «Город Москва» — это правило, а не список.

    Заведённый ПОСЛЕ группы московский отель обязан попасть в неё сам, а
    переехавший в другой город — выпасть. Хранимый состав был бы списком,
    притворяющимся правилом: человек пересобирал бы его руками и однажды забыл.
    """
    first = _hotel("msk-one", city="Москва")

    created = api(
        "post",
        "/groups",
        {"code": "msk-rule", "title": "Москва", "kind": "city", "mode": "rule",
         "rule": {"city": "Москва"}},
    )
    assert created.status_code == 201, created.content
    group = HotelGroup.objects.get(code="msk-rule")

    assert groups_svc.hotel_ids(group) == [first.pk]

    # Отель появился ПОСЛЕ группы — и оказался в ней без единого действия.
    second = _hotel("msk-two", city="Москва")
    assert set(groups_svc.hotel_ids(group)) == {first.pk, second.pk}

    # А этот переехал — и выпал.
    second.city = {"ru": "Казань"}
    second.save()
    assert groups_svc.hotel_ids(group) == [first.pk]

    # Размер на экране считается тем же кодом, а не сложением строк членства.
    listing = api("get", "/groups").json()["items"]
    assert next(row for row in listing if row["code"] == "msk-rule")["size"] == 1


def test_a_rule_group_refuses_hand_picked_members(api):
    """
    Правилу состав руками не задают: это означало бы либо изменить условие,
    либо завести исключение, о котором потом никто не вспомнит.
    """
    hotel = _hotel("byhand", city="Пермь")
    created = api(
        "post",
        "/groups",
        {"code": "demo-rule", "title": "Демо", "kind": "test", "mode": "rule",
         "rule": {"origin": "demo"}},
    )
    group_id = created.json()["id"]

    refused = api("post", f"/groups/{group_id}/members", {"hotel_ids": [str(hotel.pk)]})
    assert refused.status_code == 422, refused.content
    assert refused.json()["code"] == "group_is_rule"


def test_the_bulk_action_is_addressed_by_a_group(api):
    """
    ПЕРВАЯ ПОЛЬЗА И ПРОВЕРКА МОДЕЛИ. Массовое выключение адресуется группой, и
    состав правила считается в момент нажатия — вместе с отелем, заведённым
    после того, как группу создали.
    """
    _hotel("bulk-one", city="Сочи")
    api(
        "post",
        "/groups",
        {"code": "sochi", "title": "Сочи", "kind": "city", "mode": "rule",
         "rule": {"city": "Сочи"}},
    )
    group = HotelGroup.objects.get(code="sochi")

    late = _hotel("bulk-two", city="Сочи")

    response = api("post", "/fleet/bulk", {"group_id": str(group.pk), "is_active": False})
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["requested"] == 2, "правило не пересчитали в момент действия"
    assert body["changed"] == 2

    late.refresh_from_db()
    assert late.is_active is False, "отель, заведённый после группы, не выключили"


def test_the_fleet_filter_and_the_action_agree_on_the_same_composition(api):
    """
    Фильтр флота и массовое действие обязаны считать состав ОДНИМ кодом. Экран,
    режущий по-своему, однажды выключил бы не то, что видно.
    """
    _hotel("agree-one", city="Тверь")
    _hotel("agree-two", city="Тверь")
    _hotel("agree-other", city="Омск")

    api(
        "post",
        "/groups",
        {"code": "tver", "title": "Тверь", "kind": "city", "mode": "rule",
         "rule": {"city": "Тверь"}},
    )
    group = HotelGroup.objects.get(code="tver")

    fleet = api("get", f"/fleet?group={group.pk}").json()
    assert fleet["total"] == 2
    assert {row["subdomain"] for row in fleet["items"]} == {"agree-one", "agree-two"}

    assert len(groups_svc.hotel_ids(group)) == fleet["total"]


def test_a_missing_group_shows_nothing_rather_than_everything(api):
    """
    Удалённая группа в фильтре — пустая выдача, а не весь флот. Молча показать
    всех значит предложить массовое действие не тем.
    """
    _hotel("ghost", city="Уфа")
    fleet = api("get", "/fleet?group=00000000-0000-0000-0000-000000000000").json()
    assert fleet["total"] == 0
