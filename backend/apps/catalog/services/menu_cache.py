"""
Кэш собранного меню гостя (партия 61).

ЗАЧЕМ. Меню заведения на восемьсот позиций собирается сотни миллисекунд даже
без N+1, а гость открывает его снова и снова — с главной, из поиска, после
корзины. Собранное кладём в Redis.

ПРОТУХАНИЕ ПО ОТПЕЧАТКУ, А НЕ ПО СИГНАЛАМ. Сигналы `post_save` не видят
`queryset.update()` и жёсткие удаления, а правки каталога идут и так и так:
стоп-лист, порядок, перенарезка фото, публикация, снятие расписания. Ключ
кэша содержит отпечаток — для каждой таблицы, от которой зависит меню, число
строк и последнее `updated_at` по отелю. Любая правка, удаление или
мягкое удаление меняют отпечаток, и следующий гость получает свежую сборку.
Отпечаток — один SQL-запрос.

ВРЕМЯ. Доступность («завтрак с 07:00») зависит от того, который час, а не
только от данных, поэтому собранное живёт недолго (`TTL`): граница часов
сдвигается не больше чем на минуту. `server_time` — всегда свежий.
"""

from __future__ import annotations

import hashlib

from django.core.cache import cache
from django.db import connection

TTL = 60

# Всё, от чего зависит ответ меню: сам каталог, его словари и связи, часы,
# заведения и маршруты, заимствования, места, фото (перенарезка и фокус).
_MODELS = (
    ("catalog", "Category"),
    ("catalog", "Item"),
    ("catalog", "ItemImage"),
    ("catalog", "ItemCharacteristic"),
    ("catalog", "ItemBadge"),
    ("catalog", "Badge"),
    ("catalog", "ItemAllergen"),
    ("catalog", "Allergen"),
    ("catalog", "ItemDietaryMarker"),
    ("catalog", "DietaryMarker"),
    ("catalog", "ModifierGroup"),
    ("catalog", "ModifierOption"),
    ("catalog", "RequestField"),
    ("catalog", "SlotConfig"),
    ("catalog", "Route"),
    ("catalog", "ServiceLocation"),
    ("catalog", "ServiceInclusion"),
    ("catalog", "ServiceInclusionCategory"),
    ("catalog", "ServiceInclusionHidden"),
    ("hotels", "Service"),
    ("hotels", "ExecutionPoint"),
    ("hotels", "Schedule"),
    ("hotels", "ScheduleInterval"),
    ("hotels", "Location"),
    ("hotels", "HotelLanguage"),
    ("media", "MediaAsset"),
)


def _tables() -> list[str]:
    from django.apps import apps

    return [apps.get_model(app, name)._meta.db_table for app, name in _MODELS]


def fingerprint(hotel_id) -> str:
    """Отпечаток данных меню отеля: одна строка из одного запроса."""
    parts = [
        f"(SELECT count(*)::text || '/' || coalesce(max(updated_at)::text, '') FROM {table} WHERE hotel_id = %s)"
        for table in _tables()
    ]
    parts.append("(SELECT updated_at::text FROM hotels_hotel WHERE id = %s)")
    sql = "SELECT " + " || '|' || ".join(parts)
    with connection.cursor() as cursor:
        cursor.execute(sql, [hotel_id] * len(parts))
        row = cursor.fetchone()
    return hashlib.sha1((row[0] or "").encode()).hexdigest()[:16]


_SERVER_TIME = "__itv_server_time__"


def cached_menu_response(options, hotel):
    """
    Ответ меню через кэш — готовыми байтами JSON (партия 61).

    Кэшируем не словарь, а уже прогнанный через схему `MenuOut` текст: иначе
    ninja на каждом попадании заново валидировал бы и кодировал два
    мегабайта — это треть секунды на ответ, который не менялся. Схема та же,
    что объявлена у ручки, поэтому байты совпадают с прежним ответом.
    `server_time` подставляется на каждом ответе.
    """
    import json

    from django.http import HttpResponse
    from ninja.responses import NinjaJSONEncoder

    from apps.catalog.schemas.guest import MenuOut

    from .menu import build_menu

    def render(body: dict) -> str:
        data = MenuOut.model_validate(body).model_dump()
        data["server_time"] = _SERVER_TIME
        return json.dumps(data, cls=NinjaJSONEncoder)

    if options.moment is not None:
        # Вопрос «что будет в такой-то момент» не кэшируем: он редкий и разный.
        blob = render(build_menu(options, hotel=hotel))
    else:
        key = ":".join(
            str(part)
            for part in (
                "guest-menu",
                hotel.pk,
                options.offering_type,
                options.point_code or "",
                options.language or "",
                int(options.include_unavailable),
                options.location_id or "",
                fingerprint(hotel.pk),
            )
        )
        blob = cache.get(key)
        if blob is None:
            blob = render(build_menu(options, hotel=hotel))
            cache.set(key, blob, TTL)
    text = blob.replace(json.dumps(_SERVER_TIME), json.dumps(hotel.local_now().isoformat()), 1)
    return HttpResponse(text, content_type="application/json; charset=utf-8")
