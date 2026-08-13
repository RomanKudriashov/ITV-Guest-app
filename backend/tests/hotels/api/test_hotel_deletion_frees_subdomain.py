"""
Удалённый отель не сжигает своё имя.

Уникальный индекс не знает про `deleted_at`: мягко удалённая строка видна ему
наравне с живой. Поэтому удаление отеля навсегда занимало поддомен, и попытка
завести его заново давала не «имя занято», а необъяснённое 500 из
IntegrityError — то есть выглядела как поломка платформы, а не как отказ.

Проверяется поведение оператора целиком: удалить → создать заново → работает.
"""

from __future__ import annotations

import json

import pytest

from apps.core.context import platform_scope
from apps.hotels.models import Hotel
from apps.hotels.services.provisioning import ensure_platform_admin

pytestmark = pytest.mark.django_db(transaction=True, databases=["default", "platform"])

BASE_HOST = "guest.localhost"
OWNER = ("root@platform.test", "platform12345")


@pytest.fixture
def api(client):
    ensure_platform_admin(email=OWNER[0], password=OWNER[1])
    token = client.post(
        "/api/v1/platform/auth/login",
        data=json.dumps({"email": OWNER[0], "password": OWNER[1]}),
        content_type="application/json", HTTP_HOST=BASE_HOST,
    ).json()["access"]

    def call(method, path, body=None):
        kw = {"HTTP_HOST": BASE_HOST, "HTTP_AUTHORIZATION": f"Bearer {token}"}
        if body is not None:
            return getattr(client, method)(
                f"/api/v1/platform{path}", data=json.dumps(body),
                content_type="application/json", **kw)
        return getattr(client, method)(f"/api/v1/platform{path}", **kw)

    return call


def _create(api, subdomain="crystal", name="Кристалл"):
    return api("post", "/hotels", {
        "subdomain": subdomain, "name": name, "admin_email": f"admin@{subdomain}.test",
    })


def test_deleted_subdomain_can_be_taken_again(api):
    """
    ГЛАВНОЕ. Тот же поддомен заводится заново — 201, а не 500.

    Ответ важен не меньше факта: 500 говорит оператору «платформа сломалась»,
    и он идёт не заводить отель, а писать в поддержку.
    """
    made = _create(api)
    assert made.status_code == 201, made.content
    hotel_id = made.json()["hotel"]["id"]

    deleted = api("delete", f"/hotels/{hotel_id}?confirm_subdomain=crystal")
    assert deleted.status_code == 200, deleted.content

    again = _create(api, name="Кристалл-2")
    assert again.status_code == 201, f"поддомен сгорел: {again.status_code} {again.content[:200]}"
    assert again.json()["hotel"]["subdomain"] == "crystal"


def test_old_row_keeps_its_real_name_apart(api):
    """Имя не потеряно: оно нужно журналу и разбору инцидента."""
    hotel_id = _create(api).json()["hotel"]["id"]
    api("delete", f"/hotels/{hotel_id}?confirm_subdomain=crystal")

    with platform_scope():
        old = Hotel.all_objects.using("platform").get(pk=hotel_id)
    assert old.deleted_at is not None
    assert old.former_subdomain == "crystal", "прежнее имя не сохранилось"
    assert old.subdomain != "crystal", "имя не освобождено"
    # Припаркованное имя читаемо и содержит дату: по нему видно, что и когда.
    assert old.subdomain.startswith("crystal-deleted-")
    assert old.deleted_at.strftime("%Y%m%d") in old.subdomain


def test_parking_is_deterministic(api):
    """Тот же отель, удалённый в тот же день, — то же имя. Иначе призраки."""
    hotel_id = _create(api).json()["hotel"]["id"]
    api("delete", f"/hotels/{hotel_id}?confirm_subdomain=crystal")

    with platform_scope():
        old = Hotel.all_objects.using("platform").get(pk=hotel_id)
        assert old.parked_subdomain() == old.subdomain


def test_same_name_can_be_deleted_twice(api):
    """
    Второе удаление того же имени не должно ломаться о первый призрак.

    Без хвоста из pk припаркованные имена совпали бы, и починка поддомена
    воспроизвела бы ровно ту ошибку, от которой лечит.
    """
    first = _create(api).json()["hotel"]["id"]
    api("delete", f"/hotels/{first}?confirm_subdomain=crystal")
    second = _create(api, name="Кристалл снова").json()["hotel"]["id"]

    deleted = api("delete", f"/hotels/{second}?confirm_subdomain=crystal")
    assert deleted.status_code == 200, deleted.content

    with platform_scope():
        parked = set(
            Hotel.all_objects.using("platform")
            .filter(former_subdomain="crystal")
            .values_list("subdomain", flat=True)
        )
    assert len(parked) == 2, f"два удаления схлопнулись в одно имя: {parked}"


# --- Маршрутизация ----------------------------------------------------------


def test_routing_to_the_old_name_dies_at_once(api, client):
    """
    Немедленно и без кэша: следующий же запрос на старое имя — 404.

    Проверяется тем самым адресом, которым ходят гости, а не состоянием в
    базе: «строка помечена удалённой» и «сайт перестал открываться» — разные
    утверждения.
    """
    hotel_id = _create(api).json()["hotel"]["id"]
    alive = client.get("/api/v1/guest/hotel", HTTP_HOST="crystal.guest.localhost")
    assert alive.status_code != 404, "до удаления адрес обязан работать"

    api("delete", f"/hotels/{hotel_id}?confirm_subdomain=crystal")

    dead = client.get("/api/v1/guest/hotel", HTTP_HOST="crystal.guest.localhost")
    assert dead.status_code == 404, f"старое имя всё ещё открывает отель: {dead.status_code}"
    assert dead.json()["code"] == "unknown_tenant"


def test_parked_name_is_not_a_hotel_either(api, client):
    """На припаркованное имя тоже никто не отвечает — это не запасной вход."""
    hotel_id = _create(api).json()["hotel"]["id"]
    api("delete", f"/hotels/{hotel_id}?confirm_subdomain=crystal")

    with platform_scope():
        parked = Hotel.all_objects.using("platform").get(pk=hotel_id).subdomain

    resp = client.get("/api/v1/guest/hotel", HTTP_HOST=f"{parked}.guest.localhost")
    assert resp.status_code == 404, f"припаркованное имя открывает отель: {resp.status_code}"
