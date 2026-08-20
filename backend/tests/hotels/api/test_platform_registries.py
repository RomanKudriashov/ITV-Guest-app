"""
Реестры платформы (R6): флот, модули, узлы, команда, вход в отель, тариф.

Главная проверка здесь — не «ручка отвечает 200», а что тумблер модуля в
корневой админке МЕНЯЕТ навигацию CMS конкретного отеля. Если бы эти две
стороны разошлись, платформа продавала бы фичи, которых отель не видит, и
никакой тест на «PUT вернул 200» этого бы не поймал.
"""

from __future__ import annotations

import json

import pytest

from apps.accounts.models import User
from apps.core.context import platform_scope, tenant_context
from apps.core.models import AuditLog
from apps.hotels.services import tariffs
from apps.hotels.models import Hotel, HotelModule, OnPremNode, Service
from apps.hotels.services.provisioning import ensure_platform_admin, provision_hotel

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

BASE_HOST = "guest.localhost"
EMAIL = "root@platform.test"
PASSWORD = "platform12345"


@pytest.fixture
def token(client):
    ensure_platform_admin(email=EMAIL, password=PASSWORD)
    resp = client.post(
        "/api/v1/platform/auth/login",
        data=json.dumps({"email": EMAIL, "password": PASSWORD}),
        content_type="application/json",
        HTTP_HOST=BASE_HOST,
    )
    assert resp.status_code == 200, resp.content
    return resp.json()["access"]


@pytest.fixture
def api(client, token):
    def call(method, path, body=None):
        kw = {"HTTP_HOST": BASE_HOST, "HTTP_AUTHORIZATION": f"Bearer {token}"}
        if body is not None:
            return getattr(client, method)(
                f"/api/v1/platform{path}", data=json.dumps(body),
                content_type="application/json", **kw,
            )
        return getattr(client, method)(f"/api/v1/platform{path}", **kw)

    return call


def _add_service(hotel: Hotel, code: str) -> Service:
    """
    Ещё один сервис отелю. Со СВОЕЙ точкой исполнения: связь 1:1 (R1), и две
    услуги на одном исполнителе — не «лишняя строка», а нарушение модели.
    """
    from apps.hotels.models import ExecutionPoint

    with tenant_context(hotel):
        point = ExecutionPoint.objects.create(code=f"{code}-point", title={"ru": code})
        return Service.objects.create(code=code, type="bar", execution_point=point)


def _platform_operations():
    """
    Все платформенные операции из карты маршрутов: (методы, путь, операция).

    Дерево, а не верхний уровень: ручки живут в дочерних роутерах,
    подключённых к `/platform` с пустым префиксом.
    """
    from api import api

    def walk(router, prefix):
        for path, view in router.path_operations.items():
            for operation in view.operations:
                yield operation.methods, f"{prefix}{path}", operation
        for child in getattr(router, "_routers", []):
            yield from walk(child[1], prefix + child[0])

    for root_prefix, router in api._routers:
        if root_prefix.startswith("/platform"):
            yield from walk(router, "")


def _fill(path: str, *, hotel, node, user_id):
    """Подставить идентификаторы в шаблон пути. None — подставить нечего."""
    filled = (
        path.replace("{hotel_id}", str(hotel.pk))
        .replace("{node_id}", str(node.pk))
        .replace("{user_id}", str(user_id or ""))
        .replace("{template_id}", "")
    )
    return None if "{" in filled or filled.endswith("/") else filled


# Минимальное ВАЛИДНОЕ тело на каждый изменяющий путь.
#
# Пустое `{}` не годится: ninja проверяет тело ДО вызова вьюхи, и на неполном
# теле возвращает 422, не дойдя до права. Действие при этом не выполняется —
# граница держится, — но тест, принявший 422 за отказ, ничего бы не доказал:
# с валидным телом ручка могла бы и пропустить.
#
# Новый путь без записи здесь даст 422 и уронит тест ВСЛУХ. Это и нужно:
# добавивший ручку обязан сказать, чем её дёргать.
_BODIES = {
    "POST /fleet/bulk": {"hotel_ids": [], "is_active": False},
    "POST /hotels": {"subdomain": "probe-x", "name": "Проба", "admin_email": "a@probe.test"},
    "POST /hotels/{hotel_id}/admins": {"email": "a@probe.test"},
    "PUT /hotels/{hotel_id}/admins/email": {
        "current_email": "a@probe.test", "new_email": "b@probe.test"},
    "POST /hotels/{hotel_id}/purge": {"confirm_subdomain": "нарочно-неверный"},
    "POST /hotels/{hotel_id}/enter": {"reason": "проба границы"},
    "POST /hotels/{hotel_id}/nodes": {"name": "probe-node"},
    "PUT /hotels/{hotel_id}/tariff": {"tariff": "standard"},
    "PUT /dictionaries": {"kind": "probe", "code": "probe", "title": {"ru": "Проба"}},
    "POST /team": {"email": "probe@platform.test"},
    "POST /auth/2fa/enable": {"code": "000000"},
}


def _body_for(method: str, path: str) -> dict:
    return _BODIES.get(f"{method} {path}", {})


def _call(client, token, method: str, url: str, body: dict | None = None):
    kw = {"HTTP_HOST": BASE_HOST, "HTTP_AUTHORIZATION": f"Bearer {token}"}
    fn = getattr(client, method.lower())
    if method in ("POST", "PUT", "PATCH"):
        return fn(f"/api/v1/platform{url}", data=json.dumps(body or {}),
                  content_type="application/json", **kw)
    return fn(f"/api/v1/platform{url}", **kw)


def _login(client, email: str, password: str) -> str:
    resp = client.post(
        "/api/v1/platform/auth/login",
        data=json.dumps({"email": email, "password": password}),
        content_type="application/json",
        HTTP_HOST=BASE_HOST,
    )
    assert resp.status_code == 200, resp.content
    return resp.json()["access"]


def _node_for(hotel):
    from apps.hotels.services.onprem import register_node

    return register_node(hotel, name="probe-box", purpose="grms")


def _hotel(subdomain: str, name: str, *, origin: str = Hotel.Origin.LIVE) -> Hotel:
    return provision_hotel(
        subdomain=subdomain,
        name=name,
        admin_email=f"admin@{subdomain}.test",
        origin=origin,
    ).hotel


# --- Флот ------------------------------------------------------------------


def test_fleet_search_filter_and_pages(api):
    for index in range(4):
        _hotel(f"alpha{index}", f"Альфа {index}")
    _hotel("beta", "Бета")

    found = api("get", "/fleet?search=alpha").json()
    assert found["total"] == 4
    assert {row["subdomain"] for row in found["items"]} == {f"alpha{i}" for i in range(4)}

    paged = api("get", "/fleet?search=alpha&page_size=2&page=2").json()
    assert paged["page"] == 2 and paged["pages"] == 2 and len(paged["items"]) == 2

    # Счётчики вкладок считаются поверх ТЕКУЩЕГО поиска: «Активные · 5» рядом с
    # четырьмя найденными строками противоречило бы само себе.
    assert found["facets"]["all"] == 4


def test_fleet_hides_test_hotels_by_default(api):
    _hotel("livehotel", "Живой")
    _hotel("testhotel", "Тестовый", origin=Hotel.Origin.TEST)

    default = api("get", "/fleet").json()
    assert {row["subdomain"] for row in default["items"]} == {"livehotel"}

    # Спрятаны, но не потеряны: по явному запросу видны.
    everything = api("get", "/fleet?origin=all").json()
    assert {row["subdomain"] for row in everything["items"]} == {"livehotel", "testhotel"}


def test_fleet_bulk_counts_only_real_changes(api):
    first = _hotel("bulk1", "Один")
    second = _hotel("bulk2", "Два")
    Hotel.objects.filter(pk=second.pk).update(is_active=False)

    resp = api("post", "/fleet/bulk", {"hotel_ids": [str(first.pk), str(second.pk)], "is_active": False})
    assert resp.status_code == 200
    # Второй уже был выключен — «выключено 2» было бы неправдой.
    assert resp.json() == {"changed": 1, "requested": 2}
    assert not Hotel.objects.get(pk=first.pk).is_active


def test_fleet_export_returns_csv_of_the_same_slice(api):
    _hotel("exp1", "Экспорт один")
    _hotel("other", "Другой")

    resp = api("get", "/fleet/export?search=exp")
    assert resp.status_code == 200
    assert resp["Content-Type"].startswith("text/csv")
    body = resp.content.decode("utf-8")
    assert "exp1" in body and "other" not in body


# --- Модули ↔ навигация CMS ------------------------------------------------


def test_module_toggle_changes_cms_navigation(api, client):
    """
    Стоп-guard прогона: тумблер модуля в /admin обязан сойтись с гейтингом R4.
    Проверяем не строку в базе, а НАВИГАЦИЮ, которую увидит отель.
    """
    from apps.accounts.services.roles import access_for
    from apps.hotels.services.cms_navigation import build_navigation

    hotel = _hotel("modnav", "Модульный")

    with tenant_context(hotel):
        admin = User.objects.filter(is_hotel_admin=True).first()
        before = build_navigation(hotel, access=access_for(admin))
    keys_before = {item["key"] for group in before for item in group["items"]}
    assert "marketing" not in keys_before

    resp = api("put", f"/hotels/{hotel.pk}/modules",
               {"modules": [{"code": "marketing", "is_enabled": True}]})
    assert resp.status_code == 200

    with tenant_context(hotel):
        after = build_navigation(hotel, access=access_for(admin))
    keys_after = {item["key"] for group in after for item in group["items"]}
    assert "marketing" in keys_after

    # И обратно: выключение убирает раздел, а не оставляет его «на всякий случай».
    api("put", f"/hotels/{hotel.pk}/modules", {"modules": [{"code": "marketing", "is_enabled": False}]})
    with tenant_context(hotel):
        again = build_navigation(hotel, access=access_for(admin))
    assert "marketing" not in {item["key"] for group in again for item in group["items"]}


def test_module_source_is_decided_by_server_not_client(api):
    """
    Клиент не вправе объявить модуль «тарифным». Признак «выдано вне тарифа» —
    ответ на вопрос о тарифной сетке, и знает его только сервер.
    """
    hotel = _hotel("override", "Пилот")
    Hotel.objects.filter(pk=hotel.pk).update(tariff="standard")
    hotel.refresh_from_db()

    resp = api("put", f"/hotels/{hotel.pk}/modules",
               {"modules": [{"code": "pms", "is_enabled": True, "source": "tariff"}]})
    entry = next(m for m in resp.json()["modules"] if m["code"] == "pms")
    # Standard не даёт PMS — значит это переопределение, что бы ни прислал клиент.
    assert entry["source"] == "override"

    # А модуль, который тариф даёт, переопределением не становится.
    Hotel.objects.filter(pk=hotel.pk).update(tariff="business")
    resp = api("put", f"/hotels/{hotel.pk}/modules",
               {"modules": [{"code": "marketing", "is_enabled": True, "source": "override"}]})
    entry = next(m for m in resp.json()["modules"] if m["code"] == "marketing")
    assert entry["source"] == "tariff"


def test_modules_show_four_states_not_two(api):
    """
    «Выключили руками» и «тариф не даёт» — РАЗНЫЕ факты.

    Раньше оба показывались одинаково: `source` вычислялся формулой «override,
    если включено и тариф не даёт», и у выключенного модуля он всегда выходил
    «по тарифу». Оператор смотрел на погашенный тумблер и не мог понять,
    включать ли его обратно.
    """
    hotel = _hotel("fourstates", "Четыре")
    Hotel.objects.filter(pk=hotel.pk).update(tariff="business")

    # Business даёт marketing и room_control, не даёт pms.
    api("put", f"/hotels/{hotel.pk}/modules", {"modules": [
        {"code": "marketing", "is_enabled": True},    # тариф даёт, включено
        {"code": "pms", "is_enabled": True},          # тариф не даёт, включено руками
        {"code": "room_control", "is_enabled": False},  # тариф даёт, погашено руками
    ]})
    modules = {m["code"]: m for m in api("get", f"/hotels/{hotel.pk}/modules").json()["modules"]}

    assert (modules["marketing"]["is_enabled"], modules["marketing"]["in_tariff"]) == (True, True)
    assert (modules["pms"]["is_enabled"], modules["pms"]["in_tariff"]) == (True, False)
    assert (modules["room_control"]["is_enabled"], modules["room_control"]["in_tariff"]) == (False, True)
    # Четвёртое: тариф не даёт и не включали.
    assert (modules["native_app"]["is_enabled"], modules["native_app"]["in_tariff"]) == (False, False)

    # Намерение записано, а не выведено обратно из включённости.
    assert modules["room_control"]["intent"] == "off"
    assert modules["pms"]["intent"] == "on"
    assert modules["native_app"]["intent"] == ""


def test_downgrade_actually_turns_off_what_it_promised(api):
    """
    УКУС. Предупреждение о даунгрейде обязано стать правдой.

    До R6 `set_tariff` не трогал реестр вообще: он писал `hotel.tariff` и уходил.
    Модули старого тарифа оставались включёнными и продолжали подписываться «по
    тарифу», а список «тариф не даёт модули X» был словами — X работал дальше.
    """
    hotel = _hotel("downgrade", "Понижаем")
    Hotel.objects.filter(pk=hotel.pk).update(tariff="resort")
    api("put", f"/hotels/{hotel.pk}/modules", {"modules": [
        {"code": "pms", "is_enabled": True},
        {"code": "mobile_key", "is_enabled": True},
        {"code": "room_control", "is_enabled": True},
    ]})

    # Сначала отказ с поимённым списком — ДО того, как что-либо изменится.
    blocked = api("put", f"/hotels/{hotel.pk}/tariff", {"tariff": "standard"}).json()
    assert blocked["ok"] is False
    promised = next(w for w in blocked["warnings"] if w["key"] == "modules")["modules"]
    assert {"pms", "mobile_key", "room_control"} <= set(promised)
    # Ничего ещё не погасло: отказ — это отказ.
    assert enabled_codes(hotel) >= {"pms", "mobile_key", "room_control"}

    done = api("put", f"/hotels/{hotel.pk}/tariff",
               {"tariff": "standard", "acknowledge_downgrade": True}).json()
    assert done["ok"] is True

    # Обещанное действительно погасло — ровно то, что было перечислено.
    still_on = enabled_codes(hotel)
    assert not (set(promised) & still_on), f"обещали погасить {promised}, осталось {still_on}"
    # И это записано в журнал поимённо: «почему пропал раздел» спрашивают позже.
    assert set(done["modules_turned_off"]) == set(promised)


def test_manual_off_survives_a_tariff_that_would_grant_it(api):
    """
    Обратная сторона: тариф не зажигает то, что человек погасил.

    Иначе «выключить модуль отелю» означало бы «до ближайшей смены тарифа», и
    решение платформы отменялось бы движением, к нему не относящимся.
    """
    hotel = _hotel("intentoff", "Намерение")
    Hotel.objects.filter(pk=hotel.pk).update(tariff="standard")
    api("put", f"/hotels/{hotel.pk}/modules",
        {"modules": [{"code": "room_control", "is_enabled": False}]})

    # Переезд на тариф, который room_control ДАЁТ.
    api("put", f"/hotels/{hotel.pk}/tariff", {"tariff": "business", "acknowledge_downgrade": True})

    assert "room_control" not in enabled_codes(hotel)
    modules = {m["code"]: m for m in api("get", f"/hotels/{hotel.pk}/modules").json()["modules"]}
    # На экране это отдельное состояние, а не «тариф не даёт».
    assert modules["room_control"]["in_tariff"] is True
    assert modules["room_control"]["intent"] == "off"

    # Модули нового тарифа, которых никто не гасил, зажигаются сами.
    assert "marketing" in enabled_codes(hotel)


def enabled_codes(hotel) -> set[str]:
    from apps.hotels.module_registry import enabled_module_codes

    hotel.refresh_from_db()
    return enabled_module_codes(hotel)


# --- Тариф и лимиты --------------------------------------------------------


def test_downgrade_below_usage_is_warned_not_silent(api):
    hotel = _hotel("bigone", "Большой")
    Hotel.objects.filter(pk=hotel.pk).update(tariff="business")
    _add_service(hotel, "extra")

    blocked = api("put", f"/hotels/{hotel.pk}/tariff", {"tariff": "standard"})
    assert blocked.json()["ok"] is False
    assert blocked.json()["code"] == "downgrade_blocked"
    assert any(w["key"] == "services" for w in blocked.json()["warnings"])
    assert Hotel.objects.get(pk=hotel.pk).tariff == "business"

    # Но не запрещено намертво: платформа может решить и записать.
    forced = api("put", f"/hotels/{hotel.pk}/tariff",
                 {"tariff": "standard", "acknowledge_downgrade": True})
    assert forced.json()["ok"] is True
    assert Hotel.objects.get(pk=hotel.pk).tariff == "standard"


def test_trial_gets_an_end_date_and_days_left(api):
    hotel = _hotel("trialer", "Триальный")
    resp = api("put", f"/hotels/{hotel.pk}/tariff", {"tariff": "trial"})
    assert resp.json()["ok"] is True

    hotel.refresh_from_db()
    assert hotel.trial_ends_at is not None
    left = tariffs.trial_days_left(hotel)
    assert left is not None and 0 < left <= tariffs.get("trial").trial_days

    usage = api("get", f"/hotels/{hotel.pk}/usage").json()
    assert usage["is_trial"] is True and usage["trial_days_left"] == left


def test_usage_reports_over_limit(api):
    hotel = _hotel("overuse", "Переросший")
    Hotel.objects.filter(pk=hotel.pk).update(tariff="standard")
    _add_service(hotel, "second")

    rows = {row["key"]: row for row in api("get", f"/hotels/{hotel.pk}/usage").json()["rows"]}
    assert rows["services"]["over"] is True
    # «Без лимита» — это None, а не ноль: ноль означал бы «ничего нельзя».
    Hotel.objects.filter(pk=hotel.pk).update(tariff="resort")
    rows = {row["key"]: row for row in api("get", f"/hotels/{hotel.pk}/usage").json()["rows"]}
    assert rows["services"]["limit"] is None and rows["services"]["over"] is False


# --- Он-прем узлы ----------------------------------------------------------
#
# Тесты ниже пересекают ДВА подключения: пишут через тенантное, читают через
# платформенное (BYPASSRLS). В проде это одна база и данные видны после коммита,
# а в тесте два алиаса — две транзакции, и без реального коммита строка не
# видна. Прецедент — test_tenant_isolation.


@pytest.mark.django_db(transaction=True, databases=["default", "platform"])
def test_node_key_is_shown_once_and_stored_hashed(api, client):
    hotel = _hotel("nodehotel", "С узлом")
    created = api("post", f"/hotels/{hotel.pk}/nodes", {"name": "connector", "purpose": "grms"})
    assert created.status_code == 201
    key = created.json()["key"]

    with tenant_context(hotel):
        node = OnPremNode.objects.get(name="connector")
    # В базе — только хэш: утечка таблицы не должна давать доступ к оборудованию.
    assert node.key_hash and key not in node.key_hash

    beat = client.post(
        "/api/v1/onprem/heartbeat",
        data=json.dumps({"key": key, "version": "1.2.3"}),
        content_type="application/json",
        HTTP_HOST=BASE_HOST,
    )
    assert beat.status_code == 200 and beat.json()["hotel"] == "nodehotel"

    with tenant_context(hotel):
        node.refresh_from_db()
    assert node.is_online and node.version == "1.2.3"


@pytest.mark.django_db(transaction=True, databases=["default", "platform"])
def test_revoked_node_key_stops_working_but_row_remains(api, client):
    hotel = _hotel("revoker", "Отзыв")
    created = api("post", f"/hotels/{hotel.pk}/nodes", {"name": "box", "purpose": "pms"}).json()
    key = created["key"]

    api("post", f"/nodes/{created['node']['id']}/revoke")

    beat = client.post(
        "/api/v1/onprem/heartbeat",
        data=json.dumps({"key": key}),
        content_type="application/json",
        HTTP_HOST=BASE_HOST,
    )
    assert beat.status_code == 401 and beat.json()["code"] == "node_key_rejected"

    # Строку не удаляем: история «был узел и когда его отключили» ценнее чистоты.
    with tenant_context(hotel):
        assert OnPremNode.objects.filter(name="box", is_revoked=True).exists()


def test_unknown_key_answers_the_same_as_revoked(client):
    resp = client.post(
        "/api/v1/onprem/heartbeat",
        data=json.dumps({"key": "definitely-not-a-key"}),
        content_type="application/json",
        HTTP_HOST=BASE_HOST,
    )
    assert resp.status_code == 401 and resp.json()["code"] == "node_key_rejected"


# --- Команда и роли --------------------------------------------------------


@pytest.mark.django_db(transaction=True, databases=["default", "platform"])
def test_every_platform_route_refuses_read_only(client, api):
    """
    ПЕРЕБОР ВСЕХ ручек, а не список из четырёх.

    Прежняя версия перечисляла четыре адреса и была зелёной — потому что
    проверяла ровно те, где проверка стояла. Шесть изменяющих ручек она не
    трогала, и все шесть были открыты роли «только чтение»: переименование
    отеля, тариф, гашение отеля гостям, создание отелей, выгрузка
    персональных данных и сброс пароля администратора отеля (с выдачей
    пароля в ответе).

    Ручки берутся из карты маршрутов, поэтому новая приезжает в тест сама.
    Проверяем ровно границу: read_only получает 403 на всём, что объявлено
    правом `write` или `owner`, и НЕ получает 403 на том, что объявлено
    `read` — иначе «закрыли всё» тоже прошло бы за успех.
    """
    from apps.hotels.api.platform.rights import OWNER, READ, WRITE, declared_right

    hotel = _hotel("readonly", "Только чтение")
    node, _key = _node_for(hotel)
    invited = api("post", "/team", {"email": "viewer@platform.test", "role": "read_only"}).json()
    viewer = _login(client, "viewer@platform.test", invited["password"])

    checked = {WRITE: 0, OWNER: 0, READ: 0}
    wrong: list[str] = []
    for methods, path, operation in _platform_operations():
        right = declared_right(operation.view_func)
        if right not in (READ, WRITE, OWNER):
            continue  # публичный вход проверяется отдельно
        for method in methods:
            url = _fill(path, hotel=hotel, node=node, user_id=invited["member"]["id"])
            if url is None:
                continue
            resp = _call(client, viewer, method, url, _body_for(method, path))
            checked[right] += 1
            forbidden = resp.status_code == 403
            if right in (WRITE, OWNER) and not forbidden:
                wrong.append(f"  {method} {path} — право {right}, а ответ {resp.status_code}")
            if right == READ and forbidden:
                wrong.append(f"  {method} {path} — право read, а наблюдателя не пустили")

    assert checked[WRITE] >= 8, f"изменяющих ручек проверено всего {checked[WRITE]}"
    assert checked[OWNER] >= 4, f"владельческих ручек проверено всего {checked[OWNER]}"
    assert checked[READ] >= 8, f"читающих ручек проверено всего {checked[READ]}"
    assert not wrong, "Граница прав не там, где объявлена:\n" + "\n".join(wrong)


@pytest.mark.django_db(transaction=True, databases=["default", "platform"])
def test_owner_passes_where_read_only_is_refused(client, api):
    """
    Обратная сторона: рубеж не должен запереть и владельца.

    Без этой проверки «закрыть всё наглухо» выглядело бы как успех предыдущего
    теста.
    """
    from apps.hotels.api.platform.rights import OWNER, WRITE, declared_right

    hotel = _hotel("ownerpass", "Владелец проходит")
    node, _key = _node_for(hotel)
    owner = _login(client, EMAIL, PASSWORD)

    denied: list[str] = []
    for methods, path, operation in _platform_operations():
        if declared_right(operation.view_func) not in (WRITE, OWNER):
            continue
        for method in methods:
            # Разрушающее и необратимое владельцем НЕ дёргаем: тест про
            # границу прав, а не про офбординг.
            if any(word in path for word in ("purge", "offboard", "export")) or method == "DELETE":
                continue
            url = _fill(path, hotel=hotel, node=node, user_id=None)
            if url is None:
                continue
            resp = _call(client, owner, method, url, _body_for(method, path))
            if resp.status_code == 403:
                denied.append(f"  {method} {path} — владельцу отказали")

    assert not denied, "Рубеж запер владельца:\n" + "\n".join(denied)


@pytest.mark.django_db(transaction=True, databases=["default", "platform"])
def test_tariff_has_one_door(client, api):
    """
    Тариф меняется ТОЛЬКО через PUT /hotels/{id}/tariff.

    Две другие двери — профиль и реестр модулей — принимали то же поле без
    всякой проверки: охрана стояла на одной двери, рядом было две дыры.
    """
    hotel = _hotel("onedoor", "Одна дверь")
    assert hotel.tariff != "resort", "проба бессмысленна, если тариф уже целевой"

    api("patch", f"/hotels/{hotel.pk}", {"tariff": "resort", "name": "Через профиль"})
    api("put", f"/hotels/{hotel.pk}/modules", {"tariff": "resort", "modules": []})

    hotel.refresh_from_db()
    assert hotel.tariff != "resort", "тариф проехал мимо своей двери"
    # Имя при этом поменялось: PATCH не сломан, из него убрано одно поле.
    assert hotel.name == "Через профиль"

    api("put", f"/hotels/{hotel.pk}/tariff", {"tariff": "resort"})
    hotel.refresh_from_db()
    assert hotel.tariff == "resort", "своя дверь обязана работать"


@pytest.mark.django_db(transaction=True, databases=["default", "platform"])
def test_support_can_enter_hotels_but_not_manage_team(client, api):
    hotel = _hotel("supported", "Поддержка")
    invited = api("post", "/team", {"email": "support@platform.test", "role": "support"}).json()
    login = client.post(
        "/api/v1/platform/auth/login",
        data=json.dumps({"email": "support@platform.test", "password": invited["password"]}),
        content_type="application/json",
        HTTP_HOST=BASE_HOST,
    )
    support = login.json()["access"]

    entered = client.post(
        f"/api/v1/platform/hotels/{hotel.pk}/enter",
        data=json.dumps({"reason": "разбор обращения"}),
        content_type="application/json",
        HTTP_HOST=BASE_HOST,
        HTTP_AUTHORIZATION=f"Bearer {support}",
    )
    assert entered.status_code == 200

    team = client.post(
        "/api/v1/platform/team",
        data=json.dumps({"email": "third@platform.test"}),
        content_type="application/json",
        HTTP_HOST=BASE_HOST,
        HTTP_AUTHORIZATION=f"Bearer {support}",
    )
    assert team.status_code == 403


def test_owner_cannot_lock_himself_out(api, token):
    me = api("get", "/auth/me").json()
    disabled = api("patch", f"/team/{me['id']}", {"is_active": False})
    assert disabled.status_code == 422
    demoted = api("patch", f"/team/{me['id']}", {"role": "read_only"})
    assert demoted.status_code == 422


# --- Вход в отель ----------------------------------------------------------


@pytest.mark.django_db(transaction=True, databases=["default", "platform"])
def test_enter_hotel_requires_reason_and_is_audited(api):
    hotel = _hotel("entered", "Вход")

    assert api("post", f"/hotels/{hotel.pk}/enter", {"reason": "  "}).status_code == 422

    resp = api("post", f"/hotels/{hotel.pk}/enter", {"reason": "жалоба на разъезд", "ttl_minutes": 15})
    assert resp.status_code == 200
    body = resp.json()
    assert body["ttl_minutes"] == 15 and body["as_user"].endswith("@entered.test")

    with platform_scope():
        actions = set(
            AuditLog.all_objects.using("platform")
            .filter(hotel_id=hotel.pk)
            .values_list("action", flat=True)
        )
    # И факт входа платформы, и сам грант impersonation — оба в журнале.
    assert "platform.hotel.entered" in actions
    assert "impersonation.started" in actions


@pytest.mark.django_db(transaction=True, databases=["default", "platform"])
def test_enter_token_is_marked_as_impersonation(api, client):
    """
    Инвариант механизма: действие поддержки обязано быть отличимо от действия
    самого отеля. Отличие живёт в токене — клеймом `imp`.

    Токен теперь не выдаётся вместе с ответом на вход: наружу уходит
    одноразовый код, и CMS меняет его на токен у себя. Проверяем клеймо на
    том токене, который получается ПОСЛЕ обмена, — другого больше нет.
    """
    import json as _json

    from apps.accounts.services.tokens import decode_staff_token
    from tests.conftest import host_for

    hotel = _hotel("markme", "Метка")
    body = api("post", f"/hotels/{hotel.pk}/enter", {"reason": "проверка"}).json()
    assert "access" not in body, "токен снова уезжает в ответе на вход"

    exchanged = client.post(
        "/api/v1/staff/auth/support-exchange",
        data=_json.dumps({"code": body["code"]}),
        content_type="application/json",
        HTTP_HOST=host_for(hotel),
    )
    claims = decode_staff_token(exchanged.json()["access"])
    assert claims["imp"]
    assert claims["hotel"] == str(hotel.pk)
    assert claims["scope"] == "staff"
    # Токен привязан к гранту: без этого отзыв ничего бы не оборвал.
    assert claims["gid"] == body["grant_id"]


@pytest.mark.django_db(transaction=True, databases=["default", "platform"])
def test_enter_needs_an_active_hotel_admin(api):
    hotel = _hotel("noadmin", "Без админа")
    with tenant_context(hotel):
        User.objects.filter(is_hotel_admin=True).update(is_active=False)

    resp = api("post", f"/hotels/{hotel.pk}/enter", {"reason": "нужен доступ"})
    # Не 500 и не молчаливый вход под кем попало: платформа объясняет, чего нет.
    assert resp.status_code == 422


# --- Аудит -----------------------------------------------------------------


@pytest.mark.django_db(transaction=True, databases=["default", "platform"])
def test_audit_feed_shows_platform_actions_with_hotel_names(api):
    hotel = _hotel("audited", "Журнал")
    api("put", f"/hotels/{hotel.pk}/modules", {"modules": [{"code": "pms", "is_enabled": True}]})

    feed = api("get", "/audit").json()["items"]  # выдача теперь оболочкой: items + total
    actions = {row["action"] for row in feed}
    assert "platform.hotel.modules_set" in actions
    entry = next(row for row in feed if row["action"] == "platform.hotel.modules_set")
    assert entry["hotel"] == "Журнал"
    assert entry["actor"] == EMAIL


def test_modules_registry_lists_every_known_code(api):
    hotel = _hotel("allmods", "Все модули")
    modules = api("get", f"/hotels/{hotel.pk}/modules").json()["modules"]
    assert {entry["code"] for entry in modules} == set(HotelModule.Code.values)
