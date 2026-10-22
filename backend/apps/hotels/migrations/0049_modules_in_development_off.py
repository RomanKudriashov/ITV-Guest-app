"""
Модули в разработке («заготовки») выключаются у всех отелей (партия 62-E1).

Решения Олега (22.10.2026): тарифов нет; заготовку включить нельзя; строки
`HotelModule` не удаляются — только `is_enabled=false`, `intent=''`.

Что делает:
  * у каждой включённой заготовки — `is_enabled=false`, `intent=''`;
  * на каждую выключенную — запись в журнал отеля тем же кодом, что пишет
    ручка Control: `platform.hotel.modules_set` `{module, from: true, to:
    false, reason: "in_development"}`, автор — система;
  * из умолчаний групп (`auto_modules`) убираются заготовки, в историю группы
    — запись `platform.group.defaults_set` с «было → стало».

ОБХОД ПО ОТЕЛЯМ под `tenant_context` и ВСЕ запросы через `.using(db)`, где `db`
— подключение самой миграции: стенд мигрирует `--database=platform`, и запрос
через другое подключение ждал бы блокировку этой же транзакции (инцидент
62-A1). Под обычной ролью без `tenant_context` тенантные таблицы под RLS
отдают ноль строк — миграция «прошла» бы вхолостую.

ОБРАТНОЙ МИГРАЦИИ НЕТ (no-op): какие модули были включены, лежит в журнале
отелей; включить заготовку обратно запрещено решением, а не технически.
"""

from __future__ import annotations

import uuid

from django.db import migrations
from django.utils import timezone

from apps.core.context import tenant_context

DEV = ("pms", "payment", "mobile_key", "native_app", "analytics_level", "multi_restaurant", "extra_languages")


def forwards(apps, schema_editor):
    db = schema_editor.connection.alias
    Hotel = apps.get_model("hotels", "Hotel")
    HotelModule = apps.get_model("hotels", "HotelModule")
    HotelGroup = apps.get_model("hotels", "HotelGroup")
    AuditLog = apps.get_model("core", "AuditLog")

    now = timezone.now()
    # `intent` есть в схеме на шаге 0049 и убран миграцией 0050 (партия 62-E2).
    # По графу миграций поле здесь всегда есть; проверка — для укусов, которые
    # гоняют эту функцию на нынешних моделях.
    reset = {"is_enabled": False, "updated_at": now}
    if any(field.name == "intent" for field in HotelModule._meta.get_fields()):
        reset["intent"] = ""
    switched = 0
    for hotel in Hotel._base_manager.using(db).filter(deleted_at__isnull=True):
        with tenant_context(hotel.pk):
            rows = list(
                HotelModule._base_manager.using(db).filter(
                    hotel_id=hotel.pk, code__in=DEV, is_enabled=True, deleted_at__isnull=True
                )
            )
            for row in rows:
                HotelModule._base_manager.using(db).filter(pk=row.pk).update(**reset)
                AuditLog._base_manager.using(db).create(
                    id=uuid.uuid4(),
                    hotel_id=hotel.pk,
                    actor_type="system",
                    action="platform.hotel.modules_set",
                    object_type="hotel",
                    object_id=hotel.pk,
                    payload={"module": row.code, "from": True, "to": False, "reason": "in_development"},
                )
                switched += 1
                print(f"  {hotel.subdomain}: выключен {row.code}")

    cleaned = 0
    for group in HotelGroup._base_manager.using(db).filter(deleted_at__isnull=True):
        before = sorted(group.auto_modules or [])
        after = [code for code in before if code not in DEV]
        if after == before:
            continue
        HotelGroup._base_manager.using(db).filter(pk=group.pk).update(auto_modules=after, updated_at=now)
        AuditLog._base_manager.using(db).create(
            id=uuid.uuid4(),
            hotel_id=None,
            actor_type="system",
            action="platform.group.defaults_set",
            object_type="group",
            object_id=group.pk,
            payload={
                "code": group.code,
                "group_ids": [str(group.pk)],
                "changes": {"auto_modules": {"from": before, "to": after}},
                "reason": "in_development",
            },
        )
        cleaned += 1
    print(f"  заготовок выключено: {switched}; групп с умолчаниями поправлено: {cleaned}")


def noop(apps, schema_editor):
    """Обратного хода нет: включить заготовку нельзя, прежнее — в журнале отелей."""


class Migration(migrations.Migration):
    dependencies = [
        ("hotels", "0048_hotel_disable_and_aliases"),
        ("core", "0030_rls_order_transfer"),
    ]

    operations = [migrations.RunPython(forwards, noop)]
