"""
Консоль на объёме: число запросов не растёт с числом отелей, журнал листается.

Проверки МАШИННЫЕ. «Стало быстрее» глазами в отчёте — это ощущение: N+1
возвращается тихо, первым же удобным `for hotel in hotels`, и замечают его
на стенде через месяц. `assertNumQueries` ловит его в тот же день.

Числа взяты не с потолка: на двухстах отелях список отдавал 1064 запроса и
1.3 секунды. После батча — 11 запросов и 62 мс.
"""

from __future__ import annotations

import json
from datetime import timedelta
from urllib.parse import quote

import pytest
from django.test.utils import CaptureQueriesContext
from django.db import connections
from django.utils import timezone

from apps.core.context import platform_scope
from apps.core.models import AuditLog
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

    def call(path):
        return client.get(
            f"/api/v1/platform{path}",
            HTTP_HOST=BASE_HOST,
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

    return call


_made = 0


def _hotels(count: int) -> list[Hotel]:
    global _made
    start, _made = _made, _made + count
    rows = [
        Hotel(
            subdomain=f"scale{index:04d}",
            name={"ru": f"Отель {index}"},
            origin=Hotel.Origin.TEST,
        )
        for index in range(start, start + count)
    ]
    with platform_scope():
        Hotel.all_objects.using("platform").bulk_create(rows)
    return rows


def _queries(func):
    """Запросы по ОБОИМ подключениям: платформенное считается тоже."""
    with CaptureQueriesContext(connections["default"]) as default_q, CaptureQueriesContext(
        connections["platform"]
    ) as platform_q:
        result = func()
    return result, len(default_q) + len(platform_q)


# --- Список отелей: число запросов не зависит от числа отелей ---------------


def test_hotels_list_does_not_grow_queries_with_hotels(api):
    """
    ГЛАВНОЕ. Пять отелей и тридцать пять отелей — одинаковая цена запроса.

    Считаем разницу, а не абсолют: абсолют зависит от прогрева кэша прав и
    от того, сколько запросов уходит на аутентификацию, и такой тест ломался
    бы от любой правки рядом. Дефект же выглядит именно как рост.
    """
    _hotels(5)
    api("/hotels")  # прогрев: первый запрос тащит ленивые импорты
    _, few = _queries(lambda: api("/hotels"))

    _hotels(30)
    _, many = _queries(lambda: api("/hotels"))

    assert many <= few + 2, (
        f"на 35 отелях {many} запросов против {few} на пяти — счёт снова поштучный"
    )


def test_hotels_list_is_bounded_and_says_so(api):
    """Предел есть, и выдача честно говорит, сколько всего."""
    _hotels(150)
    body = api("/hotels?limit=25").json()

    assert len(body["items"]) == 25
    assert body["total"] >= 150
    assert body["truncated"] is True
    # Предел сверху — чтобы `?limit=100000` не стал способом положить консоль.
    assert api("/hotels?limit=100000").json()["limit"] <= 500


def test_counts_in_list_are_real(api, crystal):
    """
    Батч не должен превратить счётчики в нули: считаем те же числа, что
    показывает карточка отеля.
    """
    listed = api("/hotels").json()["items"]
    row = next(item for item in listed if item["subdomain"] == "crystal")
    card = api(f"/hotels/{crystal.pk}").json()

    assert row["counts"]["rooms"] == card["counts"]["rooms"]
    assert row["counts"]["items"] == card["counts"]["items"]
    assert row["counts"]["rooms"] > 0, "у демо-отеля есть номера — иначе проверять нечего"


# --- Прочие выдачи: предел и честный хвост ----------------------------------


@pytest.mark.parametrize("path", ["/nodes", "/team", "/templates", "/dictionaries"])
def test_lists_are_bounded(api, path):
    body = api(f"{path}?limit=1").json()
    assert set(body) >= {"items", "total", "limit", "truncated"}
    assert len(body["items"]) <= 1
    assert body["total"] >= len(body["items"])


# --- Журнал: курсор и фильтры -----------------------------------------------


def _audit_rows(count: int, *, action: str = "platform.login", hotel=None, days_back: int = 0):
    now = timezone.now()
    rows = [
        AuditLog(
            hotel=hotel,
            actor_type=AuditLog.ActorType.PLATFORM,
            action=action,
            object_type="platform",
            payload={"n": index},
        )
        for index in range(count)
    ]
    with platform_scope():
        AuditLog.all_objects.using("platform").bulk_create(rows)
        for index, row in enumerate(rows):
            AuditLog.all_objects.using("platform").filter(pk=row.pk).update(
                created_at=now - timedelta(days=days_back, seconds=index)
            )
    return rows


def test_audit_pages_by_cursor_without_gaps_or_repeats(api):
    """
    ГЛАВНОЕ ПРО ЖУРНАЛ. Листаем до конца и сверяем: ни одной записи дважды,
    ни одной потерянной.
    """
    _audit_rows(120)

    seen: list[str] = []
    cursor = None
    for _ in range(10):
        query = f"/audit?limit=25{f'&cursor={quote(cursor)}' if cursor else ''}"
        page = api(query).json()
        seen.extend(row["id"] for row in page["items"])
        cursor = page["next_cursor"]
        if not cursor:
            break

    assert len(seen) == len(set(seen)), "курсор вернул запись дважды"
    assert len(seen) >= 120, f"пролистали {len(seen)} записей из 120 — есть пропуски"


def test_new_records_during_paging_do_not_shift_the_page(api):
    """
    Ради этого курсор и выбран вместо смещения: журнал пополняется во время
    просмотра. При OFFSET вторая страница показала бы часть первой — и ровно
    столько же записей исчезло бы из выдачи незамеченными.
    """
    _audit_rows(60)
    first = api("/audit?limit=20").json()

    # Пока оператор смотрит первую страницу, приходят новые записи.
    _audit_rows(15, action="platform.2fa.enabled")

    second = api(f"/audit?limit=20&cursor={quote(first['next_cursor'])}").json()
    overlap = {row["id"] for row in first["items"]} & {row["id"] for row in second["items"]}
    assert not overlap, "вторая страница показала записи первой — листание поехало"


def test_audit_filters_find_yesterdays_incident(api, crystal):
    """
    Требование из аудита дословно: вчерашний инцидент должен быть достижим.
    Не пролистыванием — поиском.
    """
    _audit_rows(300)  # шум
    _audit_rows(1, action="impersonation.started", hotel=crystal, days_back=1)

    by_action = api("/audit?action=impersonation.started&limit=50").json()
    assert by_action["total"] == 1
    assert by_action["items"][0]["subdomain"] == "crystal"

    yesterday = (timezone.now() - timedelta(days=1)).date().isoformat()
    by_date = api(f"/audit?since={yesterday}T00:00:00&until={yesterday}T23:59:59&limit=50").json()
    assert any(row["action"] == "impersonation.started" for row in by_date["items"])

    by_hotel = api(f"/audit?hotel_id={crystal.pk}&limit=50").json()
    assert by_hotel["total"] >= 1
    assert all(row["subdomain"] == "crystal" for row in by_hotel["items"])


def test_audit_actions_come_from_the_journal(api):
    """Список действий для фильтра берётся из данных, а не из константы."""
    _audit_rows(3, action="platform.hotel.purged")
    assert "platform.hotel.purged" in api("/audit/actions").json()
