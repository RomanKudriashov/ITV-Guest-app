"""
УПРАВЛЕНИЕ НОМЕРОМ РАЗВЕДЕНО ПО ВЛАДЕЛЬЦУ РАБОТЫ.

Конфигурация — импорт ПНР, конструктор, план, публикация — наша платная
услуга. Отель её не заказывает через свою CMS и не может испортить; наш
оператор выполняет её своей учёткой, и в журнале это видно.

До разведения было два перекоса сразу. Отелю было дано ЛИШНЕЕ: администратор
мог сдвинуть зоны и опубликовать полупустой конструктор — злого умысла не
нужно, хватает любопытства. А нам не было дано НИЧЕГО: наш оператор настраивал
чужой отель имперсонацией, то есть под чужой учёткой, и на вопрос «кто сдвинул
зону» ответа не было.
"""

from __future__ import annotations

import json

import pytest

from apps.core.context import tenant_context
from apps.hotels.models import HotelModule
from tests.helpers import FIXTURES
from tests.conftest import host_for

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

PLATFORM_EMAIL = "root@platform.test"
PLATFORM_PASSWORD = "platform12345"


@pytest.fixture
def module_on(crystal):
    with tenant_context(crystal):
        HotelModule.objects.update_or_create(
            code=HotelModule.Code.ROOM_CONTROL, defaults={"is_enabled": True}
        )


@pytest.fixture
def platform(client, crystal, module_on):
    """Учётка платформы плюс адресация отеля по id — как в консоли."""
    from apps.hotels.services.provisioning import ensure_platform_admin

    ensure_platform_admin(email=PLATFORM_EMAIL, password=PLATFORM_PASSWORD)
    token = client.post(
        "/api/v1/platform/auth/login",
        data=json.dumps({"email": PLATFORM_EMAIL, "password": PLATFORM_PASSWORD}),
        content_type="application/json",
        HTTP_HOST="guest.localhost",
    ).json()["access"]

    def call(method, tail, body=None):
        path = f"/api/v1/platform/hotels/{crystal.pk}/grms{tail}"
        kw = {"HTTP_HOST": "guest.localhost", "HTTP_AUTHORIZATION": f"Bearer {token}"}
        if method == "upload":
            # Файл идёт multipart, а не JSON: клиент CMS шлёт JSON по умолчанию.
            return client.post(path, data={"file": body}, **kw)
        if body is not None:
            return getattr(client, method)(
                path, data=json.dumps(body), content_type="application/json", **kw
            )
        return getattr(client, method)(path, **kw)

    return call


def test_a_hotel_admin_cannot_reach_the_import_at_all(cms, crystal, module_on):
    """
    УКУС. Импорт ПНР для администратора отеля не существует — ни с экрана, ни
    запросом.

    Экран спрятать легко, маршрут — нет: раньше ручка жила под `/cms` и
    отвечала любому, кто дотянулся. Теперь её там НЕТ, и это 404, а не 403:
    отказ означал бы «есть, но нельзя», а её у отеля нет вовсе.
    """
    for path in (
        "/api/v1/cms/grms/import/preview",
        "/api/v1/cms/grms/catalog",
        "/api/v1/cms/grms/types/demo-suite/plan",
        "/api/v1/cms/grms/types/demo-suite/versions",
        "/api/v1/cms/grms/types/demo-suite/publish",
    ):
        response = cms.client.get(
            path,
            HTTP_HOST=host_for(cms.hotel),
            HTTP_AUTHORIZATION=f"Bearer {cms.token}",
        )
        assert response.status_code == 404, f"{path} всё ещё отвечает отелю: {response.status_code}"


def test_the_hotel_keeps_what_it_works_with_every_day(cms, crystal, module_on):
    """
    ОБРАТНАЯ СТОРОНА. Отель не остался без своего: доступ гостя, список типов и
    связь — его ежедневная работа, и она на месте.
    """
    for path in (
        "/api/v1/cms/grms/access",
        "/api/v1/cms/grms/types",
        "/api/v1/cms/grms/diagnostics/link",
    ):
        response = cms.client.get(
            path,
            HTTP_HOST=host_for(cms.hotel),
            HTTP_AUTHORIZATION=f"Bearer {cms.token}",
        )
        assert response.status_code == 200, f"{path} пропал у отеля: {response.status_code}"


def test_our_operator_opens_the_import_and_the_journal_says_it_was_the_platform(
    platform, crystal
):
    """
    УКУС. Наш оператор открывает конфигурацию — и его действие записано как
    ПЛАТФОРМЕННОЕ.

    Раньше он ходил имперсонацией, и правка выглядела как действие
    администратора отеля: на вопрос «кто менял конфигурацию» журнал отвечал
    неверно, а не молчал, — что хуже.
    """
    from apps.core.models import AuditLog
    from apps.grms.models import RoomType

    with tenant_context(crystal):
        RoomType.objects.update_or_create(
            code="ownership-suite", defaults={"title": {"ru": "Проверочный"}}
        )

    assert platform("get", "/catalog").status_code == 200
    assert platform("get", "/types").status_code == 200

    response = platform("post", "/types/ownership-suite/zones", {"code": "hall", "title": {"ru": "Холл"}})
    assert response.status_code == 200, response.content

    with tenant_context(crystal):
        entry = AuditLog.objects.filter(action="grms.zone_added").order_by("-created_at").first()
    assert entry is not None, "действие оператора не попало в журнал отеля"
    assert entry.actor_type == AuditLog.ActorType.PLATFORM, (
        f"действие записано как «{entry.actor_type}» — журнал называет чужого"
    )


def test_the_engineer_sees_the_raw_answer_and_the_hotel_does_not(platform, cms, crystal, module_on):
    """
    УКУС. Две глубины одного журнала.

    Инженеру нужен ответ на вопрос «что реально сказало железо»: сырой ответ,
    тег обмена, длительность. Администратору отеля они не нужны и вредны — он
    не поедет чинить коннектор, а «status:false» прочитает как поломку
    приложения.

    Поля ВЫРЕЗАЮТСЯ на сервере, а не прячутся на экране: приезжающий, но
    спрятанный ответ видно в консоли браузера.
    """
    # Строку журнала заводим САМИ. Проверка «в выдаче нет инженерных полей» на
    # пустом журнале сходится сама с собой и не проверяет ничего — а именно так
    # этот укус и выглядел бы на чистой базе.
    from tests.grms.api.test_grms_diagnostics import _entry

    _entry(crystal)

    engineer = platform("get", "/diagnostics?limit=5").json()
    assert engineer["depth"] == "engineer"

    hotel = cms.client.get(
        "/api/v1/cms/grms/diagnostics?limit=5",
        HTTP_HOST=host_for(cms.hotel),
        HTTP_AUTHORIZATION=f"Bearer {cms.token}",
    ).json()
    assert hotel["depth"] == "hotel"

    from apps.grms.services.diagnostics import ENGINEER_ONLY

    assert hotel["rows"], "журнал отеля пуст — резать было нечего"
    for row in hotel["rows"]:
        leaked = [field for field in ENGINEER_ONLY if field in row]
        assert not leaked, f"инженерные поля уехали отелю: {leaked}"

    # И обратная сторона: инженеру они ЕСТЬ — иначе мы бы просто всё срезали.
    assert engineer["rows"], "журнал инженера пуст — сравнивать не с чем"
    assert engineer["rows"][0]["raw_response"] == '{"status":"true","value":"1"}'


# --- Импорт: те же свойства, но на НАШЕЙ стороне -----------------------------
#
# Оба теста переехали из набора CMS вместе с ручкой. Проверяемое не изменилось:
# коннектор офлайн не блокирует сохранение, а битый файл объясняет отказ.


PNR = FIXTURES / "pnr-variables.xlsx"


def _upload_pnr(platform, handle):
    """Загрузка файла: платформенная ручка, multipart вместо JSON."""
    return platform("upload", "/import/preview", handle)


def test_reconcile_without_a_connector_does_not_block(platform, crystal):
    """
    Стоп-guard: коннектор офлайн — сверка не запускается, но сохранение
    остаётся разрешённым. Объект настраивают и до подключения коробки.
    """
    with PNR.open("rb") as handle:
        parsed = _upload_pnr(platform, handle).json()

    response = platform("post", "/import/reconcile", {"preview": parsed})
    assert response.status_code == 200
    body = response.json()
    assert body["checked"] is False
    assert all(r["reason"] == "not_checked" for r in body["reports"])

    confirm = platform("post", "/import/confirm", {"preview": parsed})
    assert confirm.status_code == 200, "несверенный импорт обязан сохраняться"


def test_broken_file_is_refused_with_an_explanation(platform, crystal):
    import io

    response = _upload_pnr(platform, io.BytesIO(b"not a workbook at all"))
    assert response.status_code == 422
