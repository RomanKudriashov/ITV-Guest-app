"""
Офбординг обязан доходить до ХРАНИЛИЩА, а не только до базы.

Почему это отдельный набор. Пока проверяли по базе, всё выглядело исполненным:
строки удалены, отметка проставлена, отель отвечает «данных нет». А файлы
лежали в бакете. На стенде это стоило 151 ГБ и дважды роняло Docker; в проде
это обещание по 152-ФЗ, выполняемое не до конца.

Поэтому здесь ПРОВЕРЯЕТСЯ ХРАНИЛИЩЕ, а не база. Тест, спрашивающий у базы,
удалены ли объекты, повторил бы ровно ту ошибку, из-за которой всё и случилось.
"""

from __future__ import annotations

import uuid

import pytest

from apps.core.context import tenant_context
from apps.hotels.models import Hotel
from apps.hotels.services import offboarding
from apps.media.models import MediaAsset
from apps.media.services import storage
from apps.media.services.assets import object_keys_of
from apps.media.tasks import purge_hotel_media

pytestmark = pytest.mark.django_db(databases=["default", "platform"])


@pytest.fixture(autouse=True)
def run_tasks_inline(settings):
    """
    Задача удаления объектов выполняется ЗДЕСЬ ЖЕ.

    В проде она уезжает в очередь — так и задумано: у отеля бывают тысячи
    объектов, и офбординг крупного отеля повесил бы запрос. Но в прогоне
    воркера нет, и без переключателя проверка свелась бы к «задача поставлена»,
    то есть ровно к тому, чего мы и боимся: поставлена — не значит выполнена.

    Переключаем НАСТРОЙКУ DJANGO, а не конфиг Celery: конфиг читается из
    настроек лениво и правку по месту молча затирает обратно.
    """
    settings.CELERY_TASK_ALWAYS_EAGER = True
    settings.CELERY_TASK_EAGER_PROPAGATES = True


def _hotel_with_asset(subdomain: str) -> tuple[Hotel, MediaAsset]:
    """Отель с одним ассетом, у которого объекты РЕАЛЬНО лежат в бакете."""
    hotel = Hotel.objects.create(
        name=f"Отель {subdomain}", subdomain=subdomain, origin=Hotel.Origin.TEST
    )
    name = f"{uuid.uuid4().hex}.png"
    original = storage.object_key(hotel.pk, "item", name)
    card = storage.object_key(hotel.pk, "item", name, variant="card")
    storage.put_bytes(original, b"original", "image/png")
    storage.put_bytes(card, b"card", "image/png")

    with tenant_context(hotel):
        asset = MediaAsset.objects.create(
            kind=MediaAsset.Kind.ITEM,
            object_key=original,
            original_filename=name,
            content_type="image/png",
            size_bytes=8,
            status=MediaAsset.Status.READY,
            variants={"card": card},
        )
    return hotel, asset


def _mark_and_purge(hotel: Hotel, callbacks) -> dict:
    offboarding.mark_for_offboarding(hotel, reason="тест", actor_id=None)
    with callbacks(execute=True):
        return offboarding.purge_hotel(hotel, confirm_subdomain=hotel.subdomain, actor_id=None)


def _stored(hotel: Hotel) -> list[str]:
    return storage.list_keys(storage.hotel_prefix(hotel.pk))


def _mark(hotel: Hotel) -> dict:
    fresh = Hotel.all_objects.get(pk=hotel.pk)
    return (fresh.settings or {}).get("offboarding") or {}


def test_offboarding_removes_objects_from_storage(django_capture_on_commit_callbacks):
    """Отель удалён — в бакете под его префиксом не осталось ничего."""
    hotel, asset = _hotel_with_asset(f"purge{uuid.uuid4().hex[:8]}")
    assert len(_stored(hotel)) == 2, "объекты не легли в бакет — проверять нечего"

    result = _mark_and_purge(hotel, django_capture_on_commit_callbacks)

    assert _stored(hotel) == [], "офбординг оставил объекты в хранилище"
    assert result["storage"]["objects"] == len(object_keys_of(asset))
    storage_mark = _mark(hotel)["storage"]
    assert storage_mark["state"] == "done"
    assert storage_mark["deleted"] == 2
    assert storage_mark["failed"] == 0


def test_storage_failure_does_not_pretend_the_hotel_is_purged(
    django_capture_on_commit_callbacks, monkeypatch
):
    """
    Хранилище отказало — отель НЕ считается полностью очищенным.

    Молчаливое «удалено» здесь хуже отказа: оператор не узнает, что часть
    данных осталась, и повторить будет нечего.
    """
    hotel, _asset = _hotel_with_asset(f"fail{uuid.uuid4().hex[:8]}")

    def refuses(keys):
        return {"deleted": [], "failed": list(keys)}

    monkeypatch.setattr(storage, "delete_objects", refuses)
    _mark_and_purge(hotel, django_capture_on_commit_callbacks)

    storage_mark = _mark(hotel)["storage"]
    assert storage_mark["state"] == "failed", "отказ хранилища выдан за успех"
    assert storage_mark["failed"] == 2
    assert storage_mark["failed_keys"], "не осталось следа, по которому можно повторить"

    # След есть — значит повтор возможен и доводит дело до конца.
    monkeypatch.undo()
    purge_hotel_media(str(hotel.pk), storage_mark["failed_keys"], storage_mark["assets"])
    assert _stored(hotel) == []
    assert _mark(hotel)["storage"]["state"] == "done"


def test_auditor_finds_orphans_and_spares_live_objects():
    """
    Ревизор сверяется С БАЗОЙ, а не с шаблоном имени.

    Подброшенный объект несуществующего отеля обязан найтись; объекты живого
    ассета обязаны остаться нетронутыми — именно так и сносят живые данные,
    когда «чистят по префиксу».
    """
    from django.core.management import call_command
    from io import StringIO

    live, live_asset = _hotel_with_asset(f"live{uuid.uuid4().hex[:8]}")
    ghost_id = uuid.uuid4()
    orphan = storage.object_key(ghost_id, "item", "ghost.png")
    storage.put_bytes(orphan, b"ghost", "image/png")

    # Сверяем ТОЛЬКО подброшенный префикс: бакет общий со стендом, и в общем
    # отчёте живая свалка прогонов заслонила бы подброшенное.
    out = StringIO()
    call_command("audit_media_storage", "--prefix", storage.hotel_prefix(ghost_id), stdout=out)
    assert str(ghost_id) in out.getvalue(), "ревизор не заметил осиротевшую папку"

    # А по префиксу живого отеля осиротевшего быть не должно.
    live_report = StringIO()
    call_command("audit_media_storage", "--prefix", storage.hotel_prefix(live.pk), stdout=live_report)
    assert "Осиротевших: 0" in live_report.getvalue(), "живые объекты сочтены осиротевшими"

    call_command("audit_media_storage", "--prefix", storage.hotel_prefix(ghost_id), "--purge",
                 stdout=StringIO())

    assert storage.list_keys(storage.hotel_prefix(ghost_id)) == [], "осиротевший объект остался"
    for key in object_keys_of(live_asset):
        assert storage.list_keys(key), f"ревизор удалил живой объект {key}"
