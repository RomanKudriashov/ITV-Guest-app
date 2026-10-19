"""
Вернуть `intent=''` модулям, которым `off` проставил массовый тумблер (партия 60).

ЧТО СЛУЧИЛОСЬ. Консоль на каждый щелчок слала весь реестр, и каждый
выключенный модуль получал `intent=off` — «выключен руками». Повышение тарифа
такие модули больше не зажигало, вернуть «по тарифу» было нечем.

КРИТЕРИЙ — все три признака сразу:
  1. `intent='off'` и модуль выключен;
  2. нынешний тариф отеля этот модуль НЕ даёт — значит, `''` и `off` сейчас
     дают одно и то же, и миграция не меняет ничего из того, что отель видит;
     разница появится только при повышении тарифа, а это и есть порча;
  3. строку записал МАССОВЫЙ запрос: в пределах секунды от неё у того же
     отеля записано ещё хотя бы одна строка с непустым намерением. Настоящий
     щелчок по одному модулю пишет одну строку; весь реестр разом писал
     только поломанный тумблер (и шаблон при создании — но тот ставит `on`).

Что НЕ трогаем: `off` у модуля, который тариф даёт, — это может быть
настоящее решение «погасить», выключенный модуль остаётся выключенным.
"""

from __future__ import annotations

from datetime import timedelta

from django.db import migrations

from apps.core.context import tenant_context

WINDOW = timedelta(seconds=1)


def forwards(apps, schema_editor):
    from apps.hotels.services import tariffs

    db = schema_editor.connection.alias
    Hotel = apps.get_model("hotels", "Hotel")
    HotelModule = apps.get_model("hotels", "HotelModule")

    reset = kept = 0
    for hotel in Hotel._base_manager.using(db).all():
        granted = set(tariffs.modules_for(hotel.tariff))
        with tenant_context(hotel.pk):
            rows = list(HotelModule._base_manager.using(db).filter(hotel_id=hotel.pk).exclude(intent=""))
            for row in rows:
                if row.intent != "off" or row.is_enabled:
                    continue
                if row.code in granted:
                    kept += 1
                    continue
                batch = [
                    other
                    for other in rows
                    if other.pk != row.pk and abs(other.updated_at - row.updated_at) <= WINDOW
                ]
                if not batch:
                    kept += 1
                    continue
                # `update`, не `save`: время записи — сам признак, его не сдвигаем.
                HotelModule._base_manager.using(db).filter(pk=row.pk).update(intent="")
                reset += 1
    print(f"  намерений «выключен руками» из массового тумблера сброшено: {reset}, оставлено: {kept}")


def noop(apps, schema_editor):
    """Обратного хода нет: прежнее `off` было порчей, а не данными."""


class Migration(migrations.Migration):
    dependencies = [("hotels", "0044_service_menu_view")]

    operations = [migrations.RunPython(forwards, noop)]
