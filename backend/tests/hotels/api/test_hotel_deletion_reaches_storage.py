"""
Удаление отеля ЛЮБЫМ путём доходит до объектного хранилища.

Путей два, и оба ведут к одной ручке платформы: оператор удаляет отель руками,
а уборка стенда после E2E — тем же `DELETE /api/v1/platform/hotels/{id}`. Пока
проверка стояла только на офбординге, вопрос «а второй путь тоже?» оставался
без ответа: код у них общий сегодня, но общим он останется ровно до первой
правки, сделанной в одном месте и забытой в другом.

Проверяется ХРАНИЛИЩЕ, а не база. Тест, спрашивающий у базы, удалены ли
объекты, повторил бы ту самую ошибку, из-за которой на стенде и накопилось
410 048 осиротевших объектов.
"""

from __future__ import annotations

import json
import uuid

import pytest

from apps.core.context import tenant_context
from apps.hotels.models import Hotel
from apps.hotels.services.provisioning import ensure_platform_admin
from apps.media.models import MediaAsset
from apps.media.services import storage

pytestmark = pytest.mark.django_db(databases=["default", "platform"])

BASE_HOST = "guest.localhost"


@pytest.fixture(autouse=True)
def run_tasks_inline(settings):
    """
    Удаление объектов выполняется ЗДЕСЬ ЖЕ.

    В проде задача уезжает в очередь — так и задумано. Но в прогоне воркера
    нет, и без переключателя проверка свелась бы к «задача поставлена», то есть
    ровно к тому, чего мы и боимся: поставлена — не значит выполнена.
    """
    settings.CELERY_TASK_ALWAYS_EAGER = True
    settings.CELERY_TASK_EAGER_PROPAGATES = True


@pytest.fixture
def platform_token(client):
    ensure_platform_admin(email="root@platform.test", password="platform12345")
    response = client.post(
        "/api/v1/platform/auth/login",
        data={"email": "root@platform.test", "password": "platform12345"},
        content_type="application/json",
        HTTP_HOST=BASE_HOST,
    )
    assert response.status_code == 200, response.content
    return response.json()["access"]


def _hotel_with_objects(subdomain: str) -> tuple[Hotel, list[str]]:
    """Отель, объекты которого РЕАЛЬНО лежат в бакете."""
    hotel = Hotel.objects.create(
        name=f"Отель {subdomain}", subdomain=subdomain, origin=Hotel.Origin.TEST
    )
    name = f"{uuid.uuid4().hex}.png"
    original = storage.object_key(hotel.pk, "item", name)
    card = storage.object_key(hotel.pk, "item", name, variant="card")
    storage.put_bytes(original, b"original", "image/png")
    storage.put_bytes(card, b"card", "image/png")

    with tenant_context(hotel):
        MediaAsset.objects.create(
            kind=MediaAsset.Kind.ITEM,
            object_key=original,
            original_filename=name,
            content_type="image/png",
            size_bytes=8,
            status=MediaAsset.Status.READY,
            variants={"card": card},
        )
    return hotel, [original, card]


def test_stand_cleanup_route_empties_the_bucket(client, platform_token, django_capture_on_commit_callbacks):
    """
    Ручка, которой пользуется уборка стенда, стирает и объекты тоже.

    Отель с признаком `test` удаляется без подтверждения поддоменом — именно
    так его и удаляет уборка после прогона. Проверяем, что «удалён» означает
    «в бакете под его префиксом пусто», а не «строки в базе нет».
    """
    hotel, keys = _hotel_with_objects(f"stand{uuid.uuid4().hex[:8]}")
    prefix = storage.hotel_prefix(hotel.pk)
    assert len(storage.list_keys(prefix)) == 2, "объекты не легли в бакет — проверять нечего"

    with django_capture_on_commit_callbacks(execute=True):
        response = client.delete(
            f"/api/v1/platform/hotels/{hotel.pk}",
            HTTP_HOST=BASE_HOST,
            HTTP_AUTHORIZATION=f"Bearer {platform_token}",
        )
    assert response.status_code == 200, response.content
    assert response.json()["deleted"] is True

    assert storage.list_keys(prefix) == [], (
        "отель удалён, а его объекты остались в хранилище — ровно так на стенде "
        "и накопились сотни тысяч файлов удалённых отелей"
    )
    # Из реестра отель пропадает. Строка при этом остаётся мягко удалённой:
    # `delete_hotel_row` зовёт `Hotel.objects.delete()`, а это по всему проекту
    # проставление `deleted_at`, а не DELETE. Для хранилища и для реестра
    # разницы нет, но обещание в докстроке ручки («вместе со строкой») шире
    # того, что она делает, — записано в отчёте отдельной строкой.
    assert not Hotel.objects.filter(pk=hotel.pk).exists(), "отель остался в реестре"


def test_deletion_spares_the_neighbour(client, platform_token, django_capture_on_commit_callbacks):
    """
    Удаляется ТОЛЬКО свой префикс.

    Обратная сторона той же проверки, и она важнее первой: «чистить по
    префиксу» пишется одной строкой, и ошибка в ней стоит чужих данных.
    """
    victim, _ = _hotel_with_objects(f"gone{uuid.uuid4().hex[:8]}")
    neighbour, neighbour_keys = _hotel_with_objects(f"live{uuid.uuid4().hex[:8]}")

    with django_capture_on_commit_callbacks(execute=True):
        response = client.delete(
            f"/api/v1/platform/hotels/{victim.pk}",
            HTTP_HOST=BASE_HOST,
            HTTP_AUTHORIZATION=f"Bearer {platform_token}",
        )
    assert response.status_code == 200, response.content

    assert storage.list_keys(storage.hotel_prefix(victim.pk)) == []
    for key in neighbour_keys:
        assert storage.list_keys(key), f"удаление соседа снесло живой объект {key}"
    assert Hotel.objects.filter(pk=neighbour.pk).exists()


def test_the_run_does_not_leave_objects_behind(client, platform_token, django_capture_on_commit_callbacks):
    """
    ПРОГОН НЕ ОСТАВЛЯЕТ ЗА СОБОЙ МУСОРА.

    База теста в конце уничтожается, а объектное хранилище — нет: оно живёт
    снаружи и переживает прогон. Именно этим на стенде и набралось 410 048
    файлов — их писали не отели, а тесты, и удалять их было некому.

    Проверка смотрит на бакет ЦЕЛИКОМ: сколько объектов было до, столько же
    должно остаться после того, как заведённый здесь отель удалён.
    """
    before = set(storage.list_keys("hotels/"))

    hotel, _ = _hotel_with_objects(f"trace{uuid.uuid4().hex[:8]}")
    assert set(storage.list_keys("hotels/")) - before, "тест ничего не записал — проверять нечего"

    with django_capture_on_commit_callbacks(execute=True):
        client.delete(
            f"/api/v1/platform/hotels/{hotel.pk}",
            HTTP_HOST=BASE_HOST,
            HTTP_AUTHORIZATION=f"Bearer {platform_token}",
        )

    left = set(storage.list_keys("hotels/")) - before
    assert left == set(), f"прогон оставил в хранилище {len(left)} объектов"
