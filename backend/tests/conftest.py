"""
Общие фикстуры.

Тесты ходят по реальному хосту-поддомену (crystal.guest.localhost), а не через
dev-заголовок: резолюция тенанта — часть того, что проверяется.
"""

from __future__ import annotations

import pytest
from django.core.management import call_command

from apps.core.context import clear_request_context, tenant_context
from apps.hotels.models import Hotel


def pytest_configure_node(node):
    """
    Передать признак прогона воркеру. Хук зовётся ТОЛЬКО в контроллере.

    Через окружение это не работает: контроллер не импортирует `_bucket` до
    подъёма воркеров, и наследовать им нечего — проверено, вышло четыре разных
    признака на четыре воркера. `workerinput` — штатный канал xdist из
    контроллера в воркер, и он единственный здесь надёжен.
    """
    from tests._bucket import RUN_ID

    node.workerinput["itv_run_id"] = RUN_ID


@pytest.fixture(scope="session", autouse=True)
def _own_media_bucket(request, worker_id):
    """
    ПРОГОН ПИШЕТ В СВОЙ БАКЕТ И УНОСИТ ЕГО С СОБОЙ.

    База теста в конце уничтожается — а объектное хранилище живёт снаружи и
    прогон переживает. Пока тесты писали в бакет стенда, каждый прогон оставлял
    в нём файлы отелей, которых уже нет ни в одной базе: 410 048 объектов в
    9 313 папках, семьдесят гигабайт за сутки. Заметили это по кончившемуся
    диску, а не по проверке, — потому что удалять их было некому: отель жил в
    тестовой базе, и вместе с ней исчез, не пройдя ни через какое удаление.

    Свой бакет решает это целиком: что бы прогон ни записал и о чём бы ни забыл,
    в конце бакет сносится вместе с содержимым. Ошибиться «забыл убрать за
    собой» больше нельзя — убирается всё сразу.

    У КАЖДОГО ВОРКЕРА СВОЙ: прогон идёт в четыре процесса, и общий бакет один
    снёс бы у другого прямо посреди работы.

    И У КАЖДОГО ПРОГОНА СВОЙ. Одного воркера в имени мало: два одновременных
    прогона получали одинаковые имена, и завершение второго выдёргивало
    хранилище из-под первого. Признак прогона живёт в `_bucket.RUN_ID` — там же
    объяснено, откуда он берётся и почему наследуется воркерами.
    """
    from django.conf import settings as dj

    from apps.media.services import storage

    from tests._bucket import RUN_ID, bucket_for

    # Признак прогона — от контроллера; без xdist его нет, берём свой.
    run_id = getattr(request.config, "workerinput", {}).get("itv_run_id", RUN_ID)

    original = dj.MINIO_BUCKET
    dj.MINIO_BUCKET = bucket_for(original, worker_id, run_id=run_id)
    # Бакет выбирается при каждом обращении, а вот его СОЗДАНИЕ закэшировано —
    # без сброса новый бакет никто не заведёт, и первая же запись упадёт.
    storage.ensure_bucket.cache_clear()
    storage.ensure_bucket()

    yield

    from tests._bucket import drop_bucket

    client = storage.get_client()
    try:
        # Сносим ИМЕННО свой бакет: помощник принимает имя и работает по нему,
        # а не по текущей настройке. Иначе сессия, у которой настройка уже
        # восстановлена, снесла бы общий бакет стенда.
        drop_bucket(client, dj.MINIO_BUCKET)
    except Exception as error:  # noqa: BLE001 — уборка не должна ронять прогон
        print(f"[хранилище] бакет прогона не убран: {error}")
    finally:
        dj.MINIO_BUCKET = original
        storage.ensure_bucket.cache_clear()


@pytest.fixture(autouse=True)
def _notifications_off(settings):
    """
    По умолчанию движок эскалации выключен: иначе каждый тест, создающий
    заказ, дёргал бы брокер и планировал ступени. Тесты эскалации включают его
    сами.
    """
    settings.NOTIFICATIONS_ENABLED = False


def _wipe_cache() -> None:
    """
    Стереть кэш ЭТОГО процесса и ничей больше.

    Базу выбирает `config/settings_test.py` — по одной на процесс прогона.
    Пока баз хватает, «своё» и «вся база» совпадают, и FLUSHDB безопасен.
    Когда процессов больше, чем свободных баз, база общая, а расходимся
    префиксом ключей — тогда FLUSHDB стёр бы соседей, и удалять надо по
    своему префиксу.
    """
    from django.conf import settings as dj_settings
    from django.core.cache import cache

    if getattr(dj_settings, "CACHE_ISOLATED_BY_DB", True):
        cache.clear()
        return

    prefix = getattr(dj_settings, "CACHE_KEY_PREFIX", "")
    client = cache._cache.get_client(write=True)
    for key in client.scan_iter(match=f"{prefix}:*"):
        client.delete(key)


@pytest.fixture(autouse=True)
def _clean_cache():
    """
    Кэш между тестами не протекает — ни к соседу, ни на живой стенд.

    С G5 в кэше живут счётчики попыток PIN, признак «команда в полёте» и
    доступность endpoint'ов узла. Чистить его обязательно: тест, начинающийся
    с заблокированного номера, иначе падал бы через раз в зависимости от
    соседа.

    Чистка — это FLUSHDB, поэтому база обязана быть СВОЯ. Раньше её подменяла
    эта фикстура (на одну и ту же для всех), и при `-n 4` четыре процесса
    флашили общую базу друг у друга посреди тестов. Теперь базу выдаёт
    `config/settings_test.py` — по одной на процесс, — а фикстуре остаётся
    только чистка.
    """
    _wipe_cache()
    yield
    _wipe_cache()


@pytest.fixture(autouse=True)
def _clean_context():
    """Контекст тенанта не должен протекать между тестами — ни в питоне, ни в БД."""
    clear_request_context()
    yield
    clear_request_context()


@pytest.fixture
def seeded(db, request):
    """
    Два отеля из сида: рабочий демо-отель и второй — для проверки изоляции.

    БЕЗ МЕДИА по умолчанию. Полный сид грузит 82 картинки в MinIO и режет их
    варианты Pillow'ом в eager-режиме — это 10,5 секунды на каждый тест при
    работе самого теста в доли секунды. Платили за это 434 теста напрямую и
    ещё 388 через производные фикстуры, а четыре процесса, одновременно
    жмущие картинки, душили машину: соседи, чувствительные ко времени,
    начинали падать — каждый прогон другие.

    Кому картинки нужны по существу — маркер:

        @pytest.mark.seed_media
        def test_...(crystal): ...

    Маркер, а не отдельная фикстура `seeded_media`: от `seeded` зависят
    `crystal`, `aurora`, `guest`, `cms`, `tracker` и прочие, и вторая ветка
    потребовала бы дублировать всю цепочку. Решение принимается здесь, в
    одном месте, а тест только объявляет потребность.
    """
    args = ["seed_demo_hotel", "--with-second-hotel"]
    if request.node.get_closest_marker("seed_media") is None:
        args.append("--without-media")
    call_command(*args, verbosity=0)
    return {
        "crystal": Hotel.objects.get(subdomain="crystal"),
        "aurora": Hotel.objects.get(subdomain="aurora"),
    }


@pytest.fixture
def crystal(seeded):
    return seeded["crystal"]


@pytest.fixture
def aurora(seeded):
    return seeded["aurora"]


def host_for(hotel: Hotel) -> str:
    return f"{hotel.subdomain}.guest.localhost"


@pytest.fixture
def guest_token(client, crystal):
    """Гостевая сессия в номере 201 демо-отеля."""
    response = client.post(
        "/api/guest/session",
        data={"room_number": "201", "language": "ru"},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
    )
    assert response.status_code == 200, response.content
    return response.json()["token"]


@pytest.fixture
def in_crystal(crystal):
    with tenant_context(crystal):
        yield crystal


# --- CMS -------------------------------------------------------------------


def staff_token_for(client, hotel, login: str = "chef") -> str:
    """
    JWT сотрудника. По умолчанию — повар: он линейный, и на нём проверяются
    трекер и чат. В CMS его с R3 не пускают (роль), поэтому CMS-фикстуры ходят
    под админом отеля — см. `cms` ниже.
    """
    response = client.post(
        "/api/staff/auth/login",
        data={"email": f"{login}@{hotel.subdomain}.local", "password": "chef12345"},
        content_type="application/json",
        HTTP_HOST=host_for(hotel),
    )
    assert response.status_code == 200, response.content
    return response.json()["access"]


class CmsClient:
    """
    Тонкая обёртка над тест-клиентом: подставляет хост отеля и JWT, чтобы
    тесты читались как список действий, а не как набор заголовков.
    """

    def __init__(self, client, hotel, token: str):
        self.client = client
        self.hotel = hotel
        self.token = token

    def _kwargs(self, extra: dict | None = None) -> dict:
        kwargs = {
            "HTTP_HOST": host_for(self.hotel),
            "HTTP_AUTHORIZATION": f"Bearer {self.token}",
        }
        kwargs.update(extra or {})
        return kwargs

    def get(self, path: str, **extra):
        return self.client.get(path, **self._kwargs(extra))

    def post(self, path: str, data=None, **extra):
        return self.client.post(
            path, data=data or {}, content_type="application/json", **self._kwargs(extra)
        )

    def patch(self, path: str, data=None, **extra):
        return self.client.patch(
            path, data=data or {}, content_type="application/json", **self._kwargs(extra)
        )

    def put(self, path: str, data=None, **extra):
        return self.client.put(
            path, data=data or {}, content_type="application/json", **self._kwargs(extra)
        )

    def delete(self, path: str, **extra):
        return self.client.delete(path, **self._kwargs(extra))

    def upload(self, path: str, files: dict, data: dict | None = None):
        return self.client.post(path, data={**(data or {}), **files}, **self._kwargs())


# Админ отеля — его заводит provision_hotel. До R3 CMS-тесты ходили под
# поваром, потому что раздел был открыт любому сотруднику; теперь роль решает,
# и «править меню» — не работа линейного персонала.
HOTEL_ADMIN = "owner"


@pytest.fixture
def cms(client, crystal):
    return CmsClient(client, crystal, staff_token_for(client, crystal, HOTEL_ADMIN))


@pytest.fixture
def cms_aurora(client, aurora):
    return CmsClient(client, aurora, staff_token_for(client, aurora, HOTEL_ADMIN))


@pytest.fixture
def cms_manager(client, crystal):
    """Управляющий рестораном «Панорама»: своя кухня — да, чужой бар — нет."""
    return CmsClient(
        client, crystal, staff_token_for(client, crystal, "manager.restaurant")
    )


@pytest.fixture
def cms_line_staff(client, crystal):
    """Линейный повар — на нём проверяется, что в CMS его не пускают."""
    return CmsClient(client, crystal, staff_token_for(client, crystal, "chef"))


@pytest.fixture
def tracker(client, crystal):
    """
    Клиент трекера — повар кухни. Доступ к доске даёт привязка к точке, а не
    роль: админ отеля ни к какой точке не привязан и на доску не попадает.
    """
    return CmsClient(client, crystal, staff_token_for(client, crystal, "chef"))


@pytest.fixture
def category_id(cms):
    """id категории «Горячее» демо-отеля."""
    tree = cms.get("/api/cms/categories").json()
    return next(node["id"] for node in tree if node["code"] == "hot")


@pytest.fixture
def service_id(cms):
    """
    id кухни «Панорама» — заведение по умолчанию для создаваемых разделов.

    Раздел без заведения не создаётся: заведение даёт исполнителя, а без
    исполнителя раздел не доезжает ни до витрины гостя, ни до доски.
    """
    services = cms.get("/api/cms/services").json()["items"]
    return next(entry["id"] for entry in services if entry["code"] == "kitchen")
