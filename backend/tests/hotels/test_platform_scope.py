"""
ОБЛАСТЬ ЧЛЕНА КОМАНДЫ: к каким отелям он имеет отношение.

Вторая ось рядом с правом. Главное её свойство — она режет ВЫДАЧУ, а не только
действия: человек, который видит чужие отели и не может их тронуть, получает
худший вид «только чтения», а сам список чужих клиентов уже утечка.

Проверяется:

* администратор группы не видит чужой отель ни в списке, ни запросом по адресу;
* его журнал показывает только его отели;
* публикация в группу шире области применяется к пересечению, и это видно
  числом ДО нажатия;
* владелец не ограничен ничем.
"""

from __future__ import annotations

import json

import pytest

from apps.hotels.models import Hotel, HotelGroup, PlatformScopeGroup
from apps.hotels.services.platform import scope

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

OWNER_EMAIL = "root@platform.test"
OWNER_PASSWORD = "platform12345"
BASE_HOST = "guest.localhost"


def _hotel(subdomain: str) -> Hotel:
    from apps.hotels.services.provisioning import provision_hotel

    return provision_hotel(
        subdomain=subdomain, name=subdomain.title(), admin_email=f"a@{subdomain}.test"
    ).hotel


def _login(client, email: str, password: str) -> str:
    response = client.post(
        "/api/v1/platform/auth/login",
        data=json.dumps({"email": email, "password": password}),
        content_type="application/json",
        HTTP_HOST=BASE_HOST,
    )
    assert response.status_code == 200, response.content
    return response.json()["access"]


def _call(client, token: str):
    def inner(method: str, path: str, body=None):
        kwargs = {"HTTP_HOST": BASE_HOST, "HTTP_AUTHORIZATION": f"Bearer {token}"}
        if body is not None:
            return getattr(client, method)(
                f"/api/v1/platform{path}",
                data=json.dumps(body),
                content_type="application/json",
                **kwargs,
            )
        return getattr(client, method)(f"/api/v1/platform{path}", **kwargs)

    return inner


@pytest.fixture
def owner(client):
    from apps.hotels.services.provisioning import ensure_platform_admin

    ensure_platform_admin(email=OWNER_EMAIL, password=OWNER_PASSWORD)
    return _call(client, _login(client, OWNER_EMAIL, OWNER_PASSWORD))


@pytest.fixture
def scoped(client, owner):
    """
    Администратор сети: право поддержки плюс область из одной группы.

    Роли «администратор группы» в перечислении НЕТ намеренно — это вторая ось,
    а не третье право.
    """
    mine = _hotel("scope-mine")
    theirs = _hotel("scope-theirs")

    created = owner("post", "/groups", {"code": "netw", "title": "Сеть", "kind": "network", "mode": "list"})
    group_id = created.json()["id"]
    owner("post", f"/groups/{group_id}/members", {"hotel_ids": [str(mine.pk)]})

    invited = owner("post", "/team", {"email": "net@platform.test", "role": "support"}).json()
    user_id = invited["member"]["id"]

    from apps.accounts.models import User
    from apps.core.context import platform_scope

    with platform_scope():
        user = User.all_objects.using("platform").get(pk=user_id)
    PlatformScopeGroup.objects.create(user_id=user.pk, group_id=group_id)

    token = _login(client, "net@platform.test", invited["password"])
    return {
        "api": _call(client, token),
        "user": user,
        "mine": mine,
        "theirs": theirs,
        "group_id": group_id,
    }


def test_a_scoped_admin_does_not_see_a_foreign_hotel_anywhere(scoped):
    """
    УКУС. Чужого отеля нет ни на экране, ни запросом.

    Список — потому что чужой клиент в списке уже утечка. Адрес — потому что
    экран не рубеж, и прямая ссылка открывалась бы мимо него.
    """
    api, mine, theirs = scoped["api"], scoped["mine"], scoped["theirs"]

    fleet = api("get", "/fleet").json()
    assert {row["subdomain"] for row in fleet["items"]} == {mine.subdomain}
    assert fleet["total"] == 1

    # 404, а не 403: отказ подтверждал бы, что такой отель существует.
    direct = api("get", f"/hotels/{theirs.pk}")
    assert direct.status_code == 404, direct.content

    own = api("get", f"/hotels/{mine.pk}")
    assert own.status_code == 200


def test_the_scoped_audit_shows_only_his_hotels(scoped, owner):
    """УКУС. Журнал администратора сети — про его отели, а не про платформу."""
    api, mine, theirs = scoped["api"], scoped["mine"], scoped["theirs"]

    # Владелец что-то делает в обоих отелях: обе записи ложатся в журнал.
    owner("patch", f"/hotels/{mine.pk}", {"name": "Мой, переименованный"})
    owner("patch", f"/hotels/{theirs.pk}", {"name": "Чужой, переименованный"})

    feed = api("get", "/audit?limit=200").json()
    hotels = {row.get("hotel_id") for row in feed["items"]}
    assert str(theirs.pk) not in hotels, "в журнале видно чужой отель"

    # И записи платформы без отеля (вход, команда) ему тоже не показываются.
    assert None not in hotels and "" not in hotels


def test_the_owner_is_never_limited(owner, scoped):
    """Владелец видит всё. Иначе платформа умеет запереть сама себя."""
    fleet = owner("get", "/fleet").json()
    subdomains = {row["subdomain"] for row in fleet["items"]}
    assert {scoped["mine"].subdomain, scoped["theirs"].subdomain} <= subdomains

    assert owner("get", f"/hotels/{scoped['theirs'].pk}").status_code == 200


def test_a_publication_to_a_wider_group_applies_to_the_intersection(scoped, owner):
    """
    УКУС. Группа шире области — применяется пересечение, и число видно ДО
    нажатия, а не выясняется по отчёту, в котором половины отелей просто нет.
    """
    api, mine, theirs = scoped["api"], scoped["mine"], scoped["theirs"]

    # Владелец заводит группу ШИРЕ: оба отеля.
    wide = owner(
        "post", "/groups", {"code": "wide", "title": "Широкая", "kind": "custom", "mode": "list"}
    ).json()
    owner(
        "post",
        f"/groups/{wide['id']}/members",
        {"hotel_ids": [str(mine.pk), str(theirs.pk)]},
    )
    # И кладёт её же в область администратора — иначе он про неё даже не узнает.
    PlatformScopeGroup.objects.create(user_id=scoped["user"].pk, group_id=wide["id"])

    payload = {"preset": "scope-badge", "label": {"ru": "Осень"}, "color_role": "gold"}
    preview = api(
        "post",
        "/publications/preview",
        {"kind": "badge", "payload": payload, "scope": "group", "group_id": wide["id"]},
    ).json()

    # Область — сеть + широкая группа, то есть оба отеля: пересечение полное.
    assert preview["count"] == 2
    assert preview["outside_scope"] == 0

    # А теперь сузим область до одной сети: та же группа даёт пересечение из
    # одного отеля, и отсечённое названо числом.
    PlatformScopeGroup.objects.filter(user_id=scoped["user"].pk, group_id=wide["id"]).delete()

    narrowed = api(
        "post",
        "/publications/preview",
        {"kind": "badge", "payload": payload, "scope": "group", "group_id": wide["id"]},
    )
    # Группы вне области он не видит вовсе — это тоже часть правила.
    assert narrowed.status_code == 404, narrowed.content


def test_a_publication_runs_within_the_scope_of_the_one_who_started_it(scoped, owner):
    """
    Исполнитель считает цель областью ЗАПУСТИВШЕГО, а не «всех подряд»: задача
    уезжает в фон, и применить право, которого у человека нет, она не должна.
    """
    from apps.hotels.models import PublicationResult
    from apps.hotels.services.platform import publication

    api, mine, theirs = scoped["api"], scoped["mine"], scoped["theirs"]

    started = api(
        "post",
        "/publications",
        {
            "kind": "badge",
            "payload": {"preset": "scope-run", "label": {"ru": "Своим"}},
            "scope": "hotels",
            # Просит оба, включая чужой.
            "hotel_ids": [str(mine.pk), str(theirs.pk)],
        },
    )
    assert started.status_code == 201, started.content
    job_id = started.json()["id"]
    publication.run(job_id)

    touched = {
        row.hotel.subdomain
        for row in PublicationResult.objects.filter(job_id=job_id).select_related("hotel")
    }
    assert touched == {mine.subdomain}, "публикация вышла за область запустившего"


def test_the_scope_service_answers_plainly(scoped):
    """Область как таковая: чем ограничен и сколько отелей видит."""
    user, mine = scoped["user"], scoped["mine"]

    assert scope.is_limited(user) is True
    assert scope.allowed_hotel_ids(user) == {mine.pk}
    described = scope.describe(user)
    assert described["limited"] is True
    assert described["hotels"] == 1
    assert [group["title"] for group in described["groups"]] == ["Сеть"]
