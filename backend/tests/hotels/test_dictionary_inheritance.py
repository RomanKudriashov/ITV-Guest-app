"""
ЭТАЛОН ПЛАТФОРМЫ И КОПИИ ОТЕЛЕЙ.

Правило одно на все такие пары: не тронуто — следует за эталоном, тронуто —
эталон не перетирает НИКОГДА, а расхождение видно платформе и возвращается
только явным действием.

Первый потребитель — системный справочник, где расхождение копилось молча: до
этой партии копии нарезались из констант кода, и запись, добавленная в консоли,
не доезжала ни до существующих отелей, ни до новых.
"""

from __future__ import annotations

import json

import pytest

from apps.catalog.models import Allergen
from apps.core.context import tenant_context
from apps.hotels.models import Hotel, SystemDictionaryEntry
from apps.hotels.services.onboarding import upsert_dictionary_entry
from apps.hotels.services.platform import dictionary_sync

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

PLATFORM_EMAIL = "root@platform.test"
PLATFORM_PASSWORD = "platform12345"
BASE_HOST = "guest.localhost"

CODE = "gluten"


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


def _title(hotel: Hotel, code: str = CODE) -> dict:
    with tenant_context(hotel):
        row = Allergen.objects.get(code=code)
    return row.title


def test_the_source_change_reaches_the_untouched_and_spares_the_edited(api):
    """
    УКУС. Платформа поменяла эталон:

    * отель, который копию НЕ трогал, получил новое значение;
    * отель, который трогал, сохранил своё — и это навсегда, а не до следующей
      правки.
    """
    untouched = _hotel("dict-follows")
    edited = _hotel("dict-edited")

    # Один отель переписал название под себя.
    with tenant_context(edited):
        row = Allergen.objects.get(code=CODE)
        row.title = {"ru": "Глютен (по-нашему)"}
        row.save(update_fields=["title"])

    response = api(
        "put",
        "/dictionaries",
        {"kind": "allergen", "code": CODE, "title": {"ru": "Глютен, обновлённый"}},
    )
    assert response.status_code == 200, response.content
    spread = response.json()["spread"]

    assert _title(untouched)["ru"] == "Глютен, обновлённый", "не тронутая копия не поехала"
    assert _title(edited)["ru"] == "Глютен (по-нашему)", "правка отеля перетёрта эталоном"

    # Числа рассылки — то, ради чего оператор смотрит на ответ.
    assert spread["updated"] >= 1
    assert spread["kept"] >= 1


def test_a_second_change_still_spares_the_edited_hotel(api):
    """
    «Навсегда» проверяется ВТОРОЙ правкой: механизм, сравнивающий копию с
    прежним значением, обязан продолжать видеть её как тронутую.
    """
    edited = _hotel("dict-keeps")
    with tenant_context(edited):
        row = Allergen.objects.get(code=CODE)
        row.title = {"ru": "Своё"}
        row.save(update_fields=["title"])

    api("put", "/dictionaries", {"kind": "allergen", "code": CODE, "title": {"ru": "Первая"}})
    api("put", "/dictionaries", {"kind": "allergen", "code": CODE, "title": {"ru": "Вторая"}})

    assert _title(edited)["ru"] == "Своё"


def test_a_new_source_entry_reaches_everyone_including_existing_hotels(api):
    """
    Новая запись эталона — это появление того, чего не было, а не перетирание
    чужого. Она доезжает до всех, включая заведённых раньше.

    Раньше не доезжала НИ ДО КОГО: копии нарезались из констант кода.
    """
    hotel = _hotel("dict-newcomer")

    api("put", "/dictionaries", {"kind": "allergen", "code": "sesame-oil", "title": {"ru": "Кунжутное масло"}})

    with tenant_context(hotel):
        assert Allergen.objects.filter(code="sesame-oil", is_system=True).exists()


def test_a_new_hotel_takes_its_copies_from_the_source_table(api):
    """
    Отель, заведённый ПОСЛЕ правки эталона, получает копии из таблицы, а не из
    констант кода.
    """
    api("put", "/dictionaries", {"kind": "allergen", "code": "lupin-extra", "title": {"ru": "Люпин особый"}})

    late = _hotel("dict-late")
    with tenant_context(late):
        assert Allergen.objects.filter(code="lupin-extra", is_system=True).exists()


def test_the_screen_shows_divergence_as_a_number(api):
    """
    УКУС. Расхождение видно ЧИСЛОМ, а не «где-то копится».
    """
    _hotel("dict-clean")
    diverged = _hotel("dict-diverged")

    with tenant_context(diverged):
        row = Allergen.objects.get(code=CODE)
        row.title = {"ru": "Расхождение"}
        row.save(update_fields=["title"])

    report = api("get", "/dictionaries/divergence").json()
    assert report["diverged_hotels"] >= 1

    row = next(r for r in report["hotels"] if r["subdomain"] == "dict-diverged")
    assert row["counts"]["changed"] >= 1
    assert any(entry["code"] == CODE and entry["state"] == "changed" for entry in row["entries"])

    clean = next(r for r in report["hotels"] if r["subdomain"] == "dict-clean")
    assert clean["counts"]["diverged"] == 0, "чистый отель попал в расхождения"


def test_reset_returns_a_hotel_to_the_source_only_when_asked(api):
    """
    «Вернуть к эталону» — явное действие по названным отелям. Соседний отель со
    своей правкой при этом не трогается: массовость не означает «всем подряд».
    """
    first = _hotel("dict-reset-me")
    second = _hotel("dict-leave-me")

    for hotel in (first, second):
        with tenant_context(hotel):
            row = Allergen.objects.get(code=CODE)
            row.title = {"ru": f"Своё у {hotel.subdomain}"}
            row.save(update_fields=["title"])

    source_title = SystemDictionaryEntry.objects.get(
        kind="allergen", code=CODE
    ).title

    response = api("post", "/dictionaries/reset", {"hotel_ids": [str(first.pk)], "codes": [CODE]})
    assert response.status_code == 200, response.content
    assert response.json()["restored"] >= 1

    assert _title(first) == source_title
    assert _title(second)["ru"] == "Своё у dict-leave-me", "тронули отель, которого не называли"


def test_a_hotels_own_entry_is_not_a_divergence(api):
    """
    Своя запись отеля — собственность, а не расхождение: возвращать её к
    эталону не к чему, и в числах она не участвует.
    """
    hotel = _hotel("dict-own")
    with tenant_context(hotel):
        Allergen.objects.create(code="our-secret-sauce", title={"ru": "Наш соус"}, is_system=False)

    report = api("get", "/dictionaries/divergence").json()
    row = next(r for r in report["hotels"] if r["subdomain"] == "dict-own")
    assert row["counts"]["diverged"] == 0
    assert all(entry["code"] != "our-secret-sauce" for entry in row["entries"])
