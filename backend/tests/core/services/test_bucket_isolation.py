"""
ДВЕ СЕССИИ НЕ СНОСЯТ ХРАНИЛИЩЕ ДРУГ У ДРУГА.

Почему на это нужен укус, а не аккуратность. Раньше бакет назывался
`guest-media-test-<воркер>`, и два одновременных прогона получали одинаковые
имена. Фикстура на выходе сносит бакет вместе с содержимым — значит завершение
второй сессии выдёргивало хранилище из-под первой, ещё работающей.

Стоило это часа разбора и неверного вывода: десятки `NoSuchBucket` в тестах
медиа, хранилища и сида GRMS выглядят как поломка кода, которого никто не
трогал, а не как чужая уборка. Правило «не гонять два прогона разом» держалось
на памяти человека, и человек его нарушил — я.

Проверяется здесь ровно то, что нельзя проверить чтением: не «имена разные», а
что снос ОДНОГО бакета не трогает второй на настоящем хранилище.
"""

from __future__ import annotations

from io import BytesIO

from apps.media.services import storage
from tests._bucket import RUN_ID, bucket_for, drop_bucket

# База здесь не нужна: проверка про объектное хранилище.


def test_two_runs_get_different_bucket_names():
    """Признак прогона входит в имя — иначе всё остальное бессмысленно."""
    first = bucket_for("guest-media", "gw0", run_id="runone")
    second = bucket_for("guest-media", "gw0", run_id="runtwo")

    assert first != second, "у двух прогонов совпали имена бакетов одного воркера"
    assert first == "guest-media-test-runone-gw0"
    # А у прогона без явного признака берётся признак текущего — тот самый,
    # под которым живут бакеты этой сессии.
    assert RUN_ID in bucket_for("guest-media", "gw0")


def test_one_session_teardown_does_not_touch_another_session_bucket():
    """
    УКУС. Два бакета «разных сессий», один сносится — второй обязан выжить.

    Имена берутся тем же помощником, что и в фикстуре: своя формула здесь
    разошлась бы с настоящей молча, и укус охранял бы не то, что работает.
    """
    client = storage.get_client()
    # ДВА РАЗНЫХ ПРОГОНА, один воркер — та самая пара, что раньше совпадала.
    mine = bucket_for("itv-isolation", "gw0", run_id="runone")
    theirs = bucket_for("itv-isolation", "gw0", run_id="runtwo")

    for name in (mine, theirs):
        if not client.bucket_exists(name):
            client.make_bucket(name)
    # Кладём объект соседу: пустой бакет сносится проще, и проверка на пустом
    # не поймала бы разницу между «не тронул» и «не смог».
    client.put_object(theirs, "keep.txt", BytesIO(b"x"), 1)

    try:
        drop_bucket(client, mine)

        assert not client.bucket_exists(mine), "свой бакет не убрался"
        assert client.bucket_exists(theirs), (
            "уборка одной сессии снесла бакет другой — ровно то, из-за чего "
            "полный прогон сыпался NoSuchBucket"
        )
        assert [item.object_name for item in client.list_objects(theirs, recursive=True)] == [
            "keep.txt"
        ], "содержимое чужого бакета пострадало"
    finally:
        if client.bucket_exists(theirs):
            drop_bucket(client, theirs)
        if client.bucket_exists(mine):
            drop_bucket(client, mine)
