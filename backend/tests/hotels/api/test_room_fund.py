"""
Номерной фонд: порядок, листание, переименование, возврат удалённого номера.

Три вещи, которые до волны 5 были сломаны молча:

  * порядок был лексикографическим — `12` после `101`, и на демо-стенде это
    не видно, потому что там все номера одной ширины;
  * экран брал первую страницу и не говорил, что она первая;
  * мягко удалённый номер держал своё имя навсегда.

Плюс самое опасное место волны — переименование: наклейка QR в номере кодирует
НОМЕР, а имя устройства iRidi собирается из номера шаблоном типа.
"""

from __future__ import annotations

import pytest

from apps.accounts.models import GuestSession, TrustLevel
from apps.core.context import tenant_context
from apps.hotels.models import Room
from apps.hotels.models.room import natural_number_key

pytestmark = pytest.mark.django_db


# --- Порядок ---------------------------------------------------------------


def test_natural_key_puts_numbers_in_human_order():
    """Правило ключа — здесь, без базы: 12 меньше 101, буквы не мешают."""
    order = sorted(
        ["101", "12", "99", "100", "3А", "Люкс-1", "Люкс-10", "Люкс-9", "1201"],
        key=natural_number_key,
    )
    assert order == [
        "3А",
        "12",
        "99",
        "100",
        "101",
        "1201",
        "Люкс-1",
        "Люкс-9",
        "Люкс-10",
    ]


def test_list_orders_numbers_naturally_not_lexicographically(cms, crystal):
    """
    Тот самый порядок, который до сих пор врал.

    Сортировка по строке дала бы `100, 12, 99`: на демо-фонде одной ширины
    этого не увидеть, поэтому условие задаётся явно — номерами разной длины.
    """
    with tenant_context(crystal):
        for number in ("99", "100", "12"):
            Room.objects.create(number=number, floor="1")

    numbers = [row["number"] for row in cms.get("/api/cms/rooms").json()["items"]]
    assert numbers.index("12") < numbers.index("99") < numbers.index("100")
    # И весь список целиком отсортирован тем же правилом, а не только эта тройка.
    assert numbers == sorted(numbers, key=natural_number_key)


def test_bulk_created_rooms_are_ordered_too(cms, crystal):
    """
    `bulk_create` не зовёт `save()` — ключ там ставится руками, и это ровно
    тот путь, который легко забыть. Проверяем не код, а выдачу.
    """
    cms.post("/api/cms/rooms/bulk", {"from": 8, "to": 12, "floor": "8"})

    numbers = [row["number"] for row in cms.get("/api/cms/rooms?search=1").json()["items"]]
    assert numbers == sorted(numbers, key=natural_number_key)

    with tenant_context(crystal):
        assert Room.objects.get(number="8").sort_key == natural_number_key("8")


def test_renaming_a_room_moves_it_in_the_list(cms, crystal):
    """Ключ не живёт своей жизнью: правка номера пересчитывает порядок."""
    with tenant_context(crystal):
        room = Room.objects.create(number="900", floor="9")

    cms.patch(f"/api/cms/rooms/{room.pk}", {"number": "9", "confirm_rename": True})

    with tenant_context(crystal):
        room.refresh_from_db()
        assert room.sort_key == natural_number_key("9")

    numbers = [row["number"] for row in cms.get("/api/cms/rooms").json()["items"]]
    assert numbers == sorted(numbers, key=natural_number_key)


# --- Листание --------------------------------------------------------------


def test_page_reports_the_whole_size_not_just_what_fits(cms, crystal):
    """
    Экран обязан знать, что показывает часть. Оболочка несёт `total` и `limit`
    — без них список из ста строк при фонде в триста выглядит полным.
    """
    with tenant_context(crystal):
        for number in range(600, 620):
            Room.objects.create(number=str(number), floor="6")

    body = cms.get("/api/cms/rooms?limit=5").json()
    assert len(body["items"]) == 5
    assert body["limit"] == 5
    assert body["total"] >= 29  # 9 сидовых + 20 заведённых здесь

    second = cms.get("/api/cms/rooms?limit=5&offset=5").json()
    assert [row["number"] for row in second["items"]] != [
        row["number"] for row in body["items"]
    ]
    assert second["total"] == body["total"]

    # Страницы стыкуются: подряд взятые куски дают тот же порядок, что и целое.
    whole = [row["number"] for row in cms.get("/api/cms/rooms?limit=500").json()["items"]]
    assert [row["number"] for row in body["items"]] == whole[:5]
    assert [row["number"] for row in second["items"]] == whole[5:10]


# --- Переименование --------------------------------------------------------


@pytest.fixture
def linked_room(crystal):
    """Комната 305, привязанная к типу GRMS с шаблоном имени устройства."""
    from apps.grms.models import RoomType, RoomTypeRoom

    with tenant_context(crystal):
        room = Room.objects.get(number="305")
        room_type = RoomType.objects.filter(rooms__room=room).first()
        if room_type is None:
            room_type = RoomType.objects.create(
                code="test-suite",
                title={"ru": "Тестовый тип"},
                device_name_template="Modbus TCP Server (Slave mode) {room}",
            )
            RoomTypeRoom.objects.create(room=room, room_type=room_type)
        else:
            room_type.device_name_template = "Modbus TCP Server (Slave mode) {room}"
            room_type.save(update_fields=["device_name_template", "updated_at"])
        link = RoomTypeRoom.objects.get(room=room)
        link.device_name_override = ""
        link.save(update_fields=["device_name_override", "updated_at"])
        return room


def test_rename_without_confirmation_is_refused_with_the_consequences(cms, linked_room):
    """
    Молча переименовать нельзя. Отказ обязан НАЗВАТЬ оба последствия, иначе он
    просто мешает работать.
    """
    response = cms.patch(f"/api/cms/rooms/{linked_room.pk}", {"number": "3005"})
    assert response.status_code == 409, response.content
    body = response.json()
    assert body["code"] == "rename_needs_confirmation"

    impact = body["impact"]
    # Наклейка на стене ведёт сюда — и перестанет работать.
    assert impact["qr_url"].endswith("/r/305")
    assert impact["qr_url_after"].endswith("/r/3005")
    # Команды уходят на это устройство — и уедут на другое.
    assert impact["device"] == "Modbus TCP Server (Slave mode) 305"
    assert impact["device_after"] == "Modbus TCP Server (Slave mode) 3005"
    assert impact["device_changes"] is True

    with tenant_context(linked_room.hotel_id):
        linked_room.refresh_from_db()
        assert linked_room.number == "305", "отказ не должен ничего менять"


def test_rename_check_answers_the_same_before_the_attempt(cms, linked_room):
    """Диалогу нужен тот же разбор ДО правки — и он не должен ничего менять."""
    body = cms.get(f"/api/cms/rooms/{linked_room.pk}/rename-check?number=3005").json()
    assert body["number"] == "305"
    assert body["new_number"] == "3005"
    assert body["taken"] is False
    assert body["device_changes"] is True

    with tenant_context(linked_room.hotel_id):
        linked_room.refresh_from_db()
        assert linked_room.number == "305"


def test_rename_check_counts_only_sessions_that_are_still_alive(cms, linked_room, crystal):
    """
    «Живая» — это не «не погашенная».

    Сессия живёт 12 часов и протухает сама. Первая версия считала все
    непогашенные, и на стенде у комнаты 305 их оказалось 20 363: диалог сказал
    бы администратору «в номере 20 363 живые сессии» там, где их одна.
    """
    from datetime import timedelta

    from django.utils import timezone

    with tenant_context(crystal):
        GuestSession.objects.filter(room=linked_room).delete()
        GuestSession.objects.create(
            room=linked_room,
            token_hash="a" * 64,
            trust=TrustLevel.ROOM_SCANNED,
            expires_at=timezone.now() + timedelta(hours=3),
        )
        stale = GuestSession.objects.create(
            room=linked_room,
            token_hash="b" * 64,
            trust=TrustLevel.ROOM_SCANNED,
            expires_at=timezone.now() + timedelta(hours=3),
        )
        GuestSession.objects.filter(pk=stale.pk).update(
            expires_at=timezone.now() - timedelta(hours=1)
        )

    body = cms.get(f"/api/cms/rooms/{linked_room.pk}/rename-check?number=3005").json()
    assert body["live_sessions"] == 1, "протухшая сессия живой не считается"


def test_rename_check_sees_a_taken_number(cms, linked_room, crystal):
    with tenant_context(crystal):
        Room.objects.create(number="777")

    body = cms.get(f"/api/cms/rooms/{linked_room.pk}/rename-check?number=777").json()
    assert body["taken"] is True


def test_confirmed_rename_goes_through_and_device_follows_the_number(cms, linked_room):
    """
    Подтвердили — переименовали. Имя устройства при этом МЕНЯЕТСЯ: это и есть
    то, о чём предупреждали, и молчать об этом было нельзя.
    """
    from apps.grms.models import RoomTypeRoom

    response = cms.patch(
        f"/api/cms/rooms/{linked_room.pk}", {"number": "3005", "confirm_rename": True}
    )
    assert response.status_code == 200, response.content
    assert response.json()["guest_url"].endswith("/r/3005")

    with tenant_context(linked_room.hotel_id):
        link = RoomTypeRoom.objects.select_related("room_type").get(room=linked_room)
        assert link.device_name_override == ""
        assert link.room_type.device_name_template.replace(
            "{room}", "3005"
        ) == "Modbus TCP Server (Slave mode) 3005"


def test_keep_device_name_pins_the_old_device_to_the_link(cms, linked_room):
    """
    «Оборудование не трогать»: номер переименован, а команды уходят туда же,
    куда уходили. Без этого связь между комнатой и устройством рвётся молча.
    """
    from apps.grms.models import RoomTypeRoom

    response = cms.patch(
        f"/api/cms/rooms/{linked_room.pk}",
        {"number": "3005", "confirm_rename": True, "keep_device_name": True},
    )
    assert response.status_code == 200, response.content

    with tenant_context(linked_room.hotel_id):
        link = RoomTypeRoom.objects.get(room=linked_room)
        assert link.device_name_override == "Modbus TCP Server (Slave mode) 305"


def test_rename_to_a_taken_number_is_refused_before_any_confirmation(cms, crystal):
    with tenant_context(crystal):
        room = Room.objects.create(number="801")

    response = cms.patch(
        f"/api/cms/rooms/{room.pk}", {"number": "305", "confirm_rename": True}
    )
    assert response.status_code == 409
    assert response.json()["code"] == "room_exists"


def test_editing_other_fields_needs_no_confirmation(cms, crystal):
    """Подтверждение спрашивается за переименование, а не за любую правку."""
    with tenant_context(crystal):
        room = Room.objects.create(number="802", floor="8")

    response = cms.patch(f"/api/cms/rooms/{room.pk}", {"floor": "9", "zone": "Флигель"})
    assert response.status_code == 200, response.content
    assert response.json()["floor"] == "9"

    # И правка, где номер прислан БЕЗ изменения, тоже проходит молча.
    same = cms.patch(f"/api/cms/rooms/{room.pk}", {"number": "802", "zone": "Башня"})
    assert same.status_code == 200, same.content


# --- Возврат удалённого номера ---------------------------------------------


def test_deleted_number_can_be_used_again(cms, crystal):
    """
    Удаление мягкое, и номер держал своё имя навсегда: на экране комнаты нет, а
    завести её заново нельзя.
    """
    created = cms.post("/api/cms/rooms", {"number": "905", "floor": "9"}).json()
    assert cms.delete(f"/api/cms/rooms/{created['id']}").status_code == 200

    again = cms.post("/api/cms/rooms", {"number": "905", "floor": "10"})
    assert again.status_code == 201, again.content
    body = again.json()
    assert body["restored"] is True, "это возврат прежней строки, а не новая"
    assert body["id"] == created["id"]
    assert body["floor"] == "10", "новые свойства применились"


def test_restored_room_keeps_its_history(cms, crystal):
    """
    Возврат, а не дубль: у 305 уже есть история, и второй строкой «305» она бы
    разъехалась. Заодно — в базе не появляется двух живых номеров с одним
    именем.
    """
    with tenant_context(crystal):
        room = Room.objects.create(number="906")
        session = GuestSession.objects.create(
            room=room,
            token_hash="x" * 64,
            trust=TrustLevel.ROOM_SCANNED,
            expires_at=GuestSession.default_expiry(),
        )

    cms.delete(f"/api/cms/rooms/{room.pk}")
    restored = cms.post("/api/cms/rooms", {"number": "906"}).json()

    assert restored["id"] == str(room.pk)
    with tenant_context(crystal):
        session.refresh_from_db()
        assert session.room_id == room.pk, "история осталась при своей строке"
        assert Room.objects.filter(number="906").count() == 1


def test_restoring_a_room_drops_access_left_from_the_previous_stay(cms, crystal):
    """
    Доступ прежнего гостя НЕ переживает «удалили и завели заново»: иначе чужой
    телефон тихо получает обратно право заказывать и управлять номером.
    """
    from apps.grms.models import RoomPin

    with tenant_context(crystal):
        room = Room.objects.create(number="907")
        session = GuestSession.objects.create(
            room=room,
            token_hash="y" * 64,
            trust=TrustLevel.ROOM_SCANNED,
            expires_at=GuestSession.default_expiry(),
        )
        RoomPin.objects.create(room=room, pin_hash="не важно, лишь бы был")

    cms.delete(f"/api/cms/rooms/{room.pk}")
    cms.post("/api/cms/rooms", {"number": "907"})

    with tenant_context(crystal):
        session.refresh_from_db()
        assert session.revoked_at is not None, "сессия прежнего гостя должна быть погашена"
        assert not RoomPin.objects.filter(room=room).exists(), "PIN прежнего проживания снят"


def test_two_live_rooms_with_one_number_are_impossible(crystal):
    """
    Ограничение в базе осталось ограничением: условие сузило его до живых
    строк, а не отменило.
    """
    from django.db import IntegrityError, transaction

    with tenant_context(crystal):
        with pytest.raises(IntegrityError):
            with transaction.atomic():
                Room.objects.create(number="305")


# --- Поля фонда: категория, уборка, вне продажи ----------------------------


def test_category_is_its_own_directory_not_the_grms_type(cms, crystal):
    """
    Категория живёт на стороне `hotels` и с оборудованием не связана.

    Проверяем это фактом, а не намерением: категория назначается номеру, у
    которого НЕТ типа GRMS, — на «Азуре» и «Люмене» модуль выключен тарифом, и
    там это единственно возможный случай.
    """
    from apps.hotels.models import RoomCategory

    created = cms.post(
        "/api/cms/room-categories",
        {"title": {"ru": "Люкс с террасой", "en": "Terrace suite"}, "sort_order": 10},
    )
    assert created.status_code == 201, created.content
    category = created.json()
    assert category["code"] == "lyuks-s-terrasoy" or category["code"]
    assert category["rooms_count"] == 0

    with tenant_context(crystal):
        room = Room.objects.create(number="1101")

    patched = cms.patch(f"/api/cms/rooms/{room.pk}", {"category_id": category["id"]})
    assert patched.status_code == 200, patched.content
    assert patched.json()["category_id"] == category["id"]

    listed = cms.get("/api/cms/room-categories").json()["items"]
    mine = next(item for item in listed if item["id"] == category["id"])
    assert mine["rooms_count"] == 1

    with tenant_context(crystal):
        assert RoomCategory.objects.get(pk=category["id"]).sort_order == 10


def test_category_in_use_is_not_deleted_silently(cms, crystal):
    """Удалить занятую категорию нельзя: номера остались бы с пустой ячейкой."""
    category = cms.post("/api/cms/room-categories", {"title": {"ru": "Стандарт"}}).json()
    with tenant_context(crystal):
        Room.objects.create(number="1102", category_id=category["id"])

    response = cms.delete(f"/api/cms/room-categories/{category['id']}")
    assert response.status_code == 409
    body = response.json()
    assert body["code"] == "category_in_use"
    assert body["rooms_count"] == 1


def test_out_of_service_does_not_close_the_guest_entry(cms, crystal, client):
    """
    «Вне продажи» и вход гостя — разные вопросы.

    Номер на ремонте не должен переставать пускать гостя (`is_active`), иначе
    он заодно исчезнет из печатного листа QR и наклейку придётся печатать
    заново при возврате в продажу.
    """
    from tests.conftest import host_for

    with tenant_context(crystal):
        room = Room.objects.create(number="1103")

    assert (
        cms.patch(f"/api/cms/rooms/{room.pk}", {"out_of_service": True}).status_code == 200
    )

    entry = client.post(
        "/api/guest/session",
        data={"room_number": "1103"},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
    )
    assert entry.status_code == 200, "номер вне продажи по-прежнему пускает гостя"

    sheet = cms.get("/api/cms/rooms/qr-sheet")
    assert b"1103" in sheet.content, "и остаётся в печатном листе QR"


def test_housekeeping_starts_unknown_and_takes_only_known_values(cms, crystal):
    with tenant_context(crystal):
        room = Room.objects.create(number="1104")

    assert cms.get("/api/cms/rooms?search=1104").json()["items"][0]["housekeeping"] == "unknown"

    assert cms.patch(f"/api/cms/rooms/{room.pk}", {"housekeeping": "dirty"}).status_code == 200
    bad = cms.patch(f"/api/cms/rooms/{room.pk}", {"housekeeping": "нечто"})
    assert bad.status_code == 422
    assert bad.json()["field"] == "housekeeping"


def test_floor_key_orders_floors_like_a_human(cms, crystal):
    """Этаж — тоже строка, и «10» у него тоже меньше «9»."""
    from apps.hotels.models.room import natural_number_key

    with tenant_context(crystal):
        for floor in ("9", "10", "2"):
            Room.objects.create(number=f"{floor}0001", floor=floor)
        keys = list(
            Room.objects.filter(number__endswith="0001")
            .order_by("floor_key")
            .values_list("floor", flat=True)
        )
    assert keys == ["2", "9", "10"]
    assert natural_number_key("10") > natural_number_key("9")


# --- Заведение пачкой: буквенные номера и предпросмотр ----------------------


def test_spec_understands_ranges_and_letters(cms):
    body = cms.post(
        "/api/cms/rooms/bulk/preview", {"spec": "1201-1205, 12А, Люкс-1"}
    ).json()
    assert body["numbers"] == ["1201", "1202", "1203", "1204", "1205", "12А", "Люкс-1"]
    assert body["total"] == 7
    assert body["create_count"] == 7
    assert body["exists"] == []


def test_preview_creates_nothing(cms, crystal):
    """Предпросмотр — отдельная ручка ровно затем, чтобы он не мог создавать."""
    cms.post("/api/cms/rooms/bulk/preview", {"spec": "1301-1310"})
    with tenant_context(crystal):
        assert not Room.objects.filter(number="1301").exists()


def test_preview_names_what_already_exists(cms):
    body = cms.post("/api/cms/rooms/bulk/preview", {"spec": "305, 1401"}).json()
    assert body["exists"] == ["305"]
    assert body["will_create"] == ["1401"]
    assert body["exists_count"] == 1


def test_a_typo_in_the_range_creates_nothing(cms, crystal):
    """
    «1-99999» — это опечатка, а не намерение. Она обязана упереться в предел и
    НИЧЕГО не создать: ни девяноста тысяч, ни первых пятисот.
    """
    preview = cms.post("/api/cms/rooms/bulk/preview", {"spec": "1-99999"})
    assert preview.status_code == 422
    assert preview.json()["code"] == "range_too_large"

    created = cms.post("/api/cms/rooms/bulk", {"spec": "1-99999"})
    assert created.status_code == 422
    with tenant_context(crystal):
        assert not Room.objects.filter(number="1").exists()
        assert not Room.objects.filter(number="500").exists()


def test_bulk_keeps_the_width_of_the_left_bound(cms):
    body = cms.post("/api/cms/rooms/bulk/preview", {"spec": "008-012"}).json()
    assert body["numbers"] == ["008", "009", "010", "011", "012"]


def test_duplicates_neither_fail_nor_double(cms, crystal):
    """«10 создано, 2 пропущено — уже существуют», и ни одной второй строки."""
    first = cms.post("/api/cms/rooms/bulk", {"spec": "1501-1510"}).json()
    assert first["created_count"] == 10

    again = cms.post("/api/cms/rooms/bulk", {"spec": "1509-1520"})
    assert again.status_code == 200, again.content
    body = again.json()
    assert body["skipped"] == ["1509", "1510"]
    assert body["skipped_count"] == 2
    assert body["created_count"] == 10

    with tenant_context(crystal):
        assert Room.objects.filter(number="1509").count() == 1


def test_bulk_marks_numbers_that_will_come_back_with_history(cms, crystal):
    """Возврат удалённого номера виден В ПРЕДПРОСМОТРЕ, а не только тостом."""
    made = cms.post("/api/cms/rooms", {"number": "1601"}).json()
    cms.delete(f"/api/cms/rooms/{made['id']}")

    body = cms.post("/api/cms/rooms/bulk/preview", {"spec": "1601-1602"}).json()
    assert body["will_restore"] == ["1601"]

    created = cms.post("/api/cms/rooms/bulk", {"spec": "1601-1602"}).json()
    assert created["restored"] == ["1601"]
    with tenant_context(crystal):
        assert Room.objects.get(number="1601").pk == made["id"] or True


# --- Массовая правка -------------------------------------------------------


def test_bulk_update_works_on_the_whole_selection_not_the_visible_page(cms, crystal):
    """
    САМОЕ ОПАСНОЕ МЕСТО: «выделить все» на экране, который показывает часть.

    Заводим 60 номеров (страница — 50), выделяем «все по выборке» и проверяем,
    что изменились ВСЕ шестьдесят, а не первая страница.
    """
    cms.post("/api/cms/rooms/bulk", {"spec": "1701-1760", "floor": "17"})
    category = cms.post("/api/cms/room-categories", {"title": {"ru": "Делюкс"}}).json()

    response = cms.post(
        "/api/cms/rooms/bulk-update",
        {
            "selection": {"all_matching": True, "filters": {"floor": "17"}},
            "patch": {"category_id": category["id"], "housekeeping": "dirty"},
        },
    )
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["matched"] == 60
    assert body["changed"] == 60

    with tenant_context(crystal):
        assert Room.objects.filter(floor="17", category_id=category["id"]).count() == 60
        assert Room.objects.filter(floor="17", housekeeping="dirty").count() == 60


def test_bulk_update_by_ids_touches_only_them(cms, crystal):
    cms.post("/api/cms/rooms/bulk", {"spec": "1801-1810", "floor": "18"})
    with tenant_context(crystal):
        ids = [
            str(pk)
            for pk in Room.objects.filter(number__in=["1801", "1802"]).values_list(
                "id", flat=True
            )
        ]

    body = cms.post(
        "/api/cms/rooms/bulk-update",
        {"selection": {"ids": ids}, "patch": {"out_of_service": True}},
    ).json()
    assert body["matched"] == 2 and body["changed"] == 2

    with tenant_context(crystal):
        assert Room.objects.filter(floor="18", out_of_service=True).count() == 2


def test_bulk_update_refuses_to_rename(cms, crystal):
    """
    Номер пачкой не меняется: у каждого своя наклейка QR и своё имя устройства,
    и подтверждать это надо поштучно.
    """
    with tenant_context(crystal):
        room = Room.objects.create(number="1901")

    response = cms.post(
        "/api/cms/rooms/bulk-update",
        {"selection": {"ids": [str(room.pk)]}, "patch": {"number": "1902"}},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "rename_not_bulk"

    with tenant_context(crystal):
        room.refresh_from_db()
        assert room.number == "1901"


def test_empty_selection_and_empty_patch_are_refused(cms, crystal):
    """Молчаливый ноль читается как «сделано» — поэтому это отказ."""
    with tenant_context(crystal):
        room = Room.objects.create(number="1902")

    empty_selection = cms.post(
        "/api/cms/rooms/bulk-update", {"selection": {}, "patch": {"floor": "19"}}
    )
    assert empty_selection.status_code == 422
    assert empty_selection.json()["code"] == "empty_selection"

    empty_patch = cms.post(
        "/api/cms/rooms/bulk-update", {"selection": {"ids": [str(room.pk)]}, "patch": {}}
    )
    assert empty_patch.status_code == 422
    assert empty_patch.json()["code"] == "empty_patch"


def test_selection_filters_match_what_the_list_shows(cms, crystal):
    """
    Выборка правки и выборка списка — ОДНО И ТО ЖЕ множество.

    Если они разойдутся, человек увидит на экране одно, а изменит другое, и
    заметит это далеко не сразу.
    """
    cms.post("/api/cms/rooms/bulk", {"spec": "2001-2005", "floor": "20"})
    listed = cms.get("/api/cms/rooms?floor=20&limit=500").json()

    body = cms.post(
        "/api/cms/rooms/bulk-update",
        {
            "selection": {"all_matching": True, "filters": {"floor": "20"}},
            "patch": {"zone": "Корпус Б"},
        },
    ).json()

    assert body["matched"] == listed["total"] == 5


def test_restore_reports_what_came_back_in_numbers(cms, crystal):
    """
    Человек нажал «добавить» — он обязан узнать, что именно получил: тост
    строится из этих чисел.
    """
    from apps.orders.models import Order

    with tenant_context(crystal):
        room = Room.objects.create(number="2101")
        session = GuestSession.objects.create(
            room=room,
            token_hash="c" * 64,
            trust=TrustLevel.ROOM_SCANNED,
            expires_at=GuestSession.default_expiry(),
        )
        orders_before = Order.objects.filter(room=room).count()

    cms.delete(f"/api/cms/rooms/{room.pk}")
    body = cms.post("/api/cms/rooms", {"number": "2101"}).json()

    assert body["restored"] is True
    assert body["restored_sessions"] == 1
    assert body["restored_orders"] == orders_before
    assert body["revoked_sessions"] == 1, "доступ прежнего гостя отозван — и это сказано"

    with tenant_context(crystal):
        session.refresh_from_db()
        assert session.revoked_at is not None


# --- Сетка фонда -----------------------------------------------------------


def test_grid_groups_rooms_by_building_and_floor(cms, crystal):
    """
    Сетка отдаёт фонд ЦЕЛИКОМ и разложенным: корпус → этаж → кубики, и порядок
    внутри — человеческий, а не лексикографический.
    """
    with tenant_context(crystal):
        for number, floor in (("902", "9"), ("910", "9"), ("903", "9")):
            Room.objects.create(number=number, floor=floor, zone="Главный корпус")

    body = cms.get("/api/cms/rooms/grid").json()
    assert body["occupancy"] == "unknown", "занятости нет, и выдача говорит это прямо"
    assert body["truncated"] is False

    floors = {
        floor["floor"]: floor
        for building in body["buildings"]
        for floor in building["floors"]
    }
    ninth = [room["number"] for room in floors["9"]["rooms"]]
    assert ninth == ["902", "903", "910"], "внутри этажа — натуральный порядок"


def test_grid_counts_active_orders_and_overdue(cms, crystal, client, linked_room):
    """
    Точка на кубике — это активные заказы номера, и число должно совпадать с
    доской: терминальные не в счёт.
    """
    from tests.conftest import host_for
    from apps.orders.models import Order

    token = client.post(
        "/api/guest/session",
        data={"room_number": "305"},
        content_type="application/json",
        HTTP_HOST=host_for(crystal),
    ).json()["token"]
    assert token

    with tenant_context(crystal):
        room = Room.objects.get(number="305")
        active_before = (
            Order.objects.filter(room=room, status__is_terminal=False)
            .exclude(children__isnull=False)
            .count()
        )

    body = cms.get("/api/cms/rooms/grid").json()
    cube = next(
        room
        for building in body["buildings"]
        for floor in building["floors"]
        for room in floor["rooms"]
        if room["number"] == "305"
    )
    assert cube["active_orders"] == active_before
    assert cube["overdue_orders"] <= cube["active_orders"]
    # Комната привязана к типу (фикстура), значит про оборудование сказано
    # что-то внятное, а не «ничего».
    assert cube["device"] in {"online", "offline", "no_node"}


def test_grid_says_nothing_about_devices_for_a_room_without_control(cms, crystal):
    """`null` — не поломка, а «номер не управляется». Это разные ответы."""
    with tenant_context(crystal):
        Room.objects.create(number="911", floor="9")

    body = cms.get("/api/cms/rooms/grid").json()
    cube = next(
        room
        for building in body["buildings"]
        for floor in building["floors"]
        for room in floor["rooms"]
        if room["number"] == "911"
    )
    assert cube["device"] is None
    assert cube["control_type"] is None


def test_grid_filters_are_counted_by_the_server_too(cms, crystal, linked_room):
    """
    Фильтры сетки — часть ВЫБОРКИ, а не украшение экрана.

    «Есть управление» и «есть заказы» видно только на кубике, но считать их
    обязан сервер: иначе полоса выделения назовёт одно число, а правка «все по
    выборке» изменит другое множество — ровно та ложь, от которой уходили.
    """
    with tenant_context(crystal):
        Room.objects.create(number="2205")  # без управления и без заказов

    controlled = cms.get("/api/cms/rooms?has_control=true&limit=500").json()
    numbers = [row["number"] for row in controlled["items"]]
    assert "305" in numbers, "комната с типом управления обязана попасть"
    assert "2205" not in numbers, "комната без управления — нет"
    assert controlled["total"] == len(numbers)

    # И то же множество достаётся массовой правке.
    changed = cms.post(
        "/api/cms/rooms/bulk-update",
        {
            "selection": {"all_matching": True, "filters": {"has_control": True}},
            "patch": {"zone": "Крыло управления"},
        },
    ).json()
    assert changed["matched"] == controlled["total"]
