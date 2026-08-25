"""
УРОВЕНЬ ПЛАНА — ЗАПИСАННОЕ РЕШЕНИЕ, А НЕ ДОГАДКА ПО КАДРАМ.

Вид экрана номера выводился из содержимого `plan`: пара кадров — полный план,
один — простой, пусто — плашки. Это догадка того же класса, что мы уже дважды
чинили (порог SLA, `source` у модулей), и цена у неё та же: снятый по ошибке
кадр молча понижает купленную услугу, а «мы продали простой план» неотличимо от
«полный ещё не доделан».

Уровень задаём МЫ. Отель его не меняет, гость про уровни не знает.
"""

from __future__ import annotations

from apps.core.models import AuditLog

# Кто нажал — в этих проверках неважно: они про механику публикации,
# а не про владельца действия. Называем систему, а не выдумываем человека.
SYSTEM_ACTOR = AuditLog.ActorType.SYSTEM

import pytest

from apps.core.context import tenant_context
from apps.grms.models import RoomType

pytestmark = pytest.mark.django_db


@pytest.fixture
def room_type(crystal) -> RoomType:
    """
    Тип с ПОЛНЫМ планом — как после нашей пусконаладки. Заводим свой, а не
    ищем сидовый: тест про уровень не должен зависеть от того, что положил сид.
    """
    with tenant_context(crystal):
        yield RoomType.objects.create(
            code="level-suite",
            title={"ru": "Люкс"},
            plan={"asset_id": "lit", "asset_off_id": "night", "zones": []},
            plan_level=RoomType.PlanLevel.FULL,
        )


def test_removing_the_frames_does_not_downgrade_the_level(crystal, room_type):
    """
    УКУС. Снять кадры у полного типа — уровень ОСТАЁТСЯ полным.

    Ровно то, ради чего поле заведено. Пока вид считался по кадрам, инженер,
    перезаливающий рендер, на минуту превращал купленный полный план в плашки —
    и если в эту минуту заходил гость, он видел список кнопок вместо комнаты.
    """
    with tenant_context(crystal):
        # Снимаем кадры целиком — как при перезаливке.
        room_type.plan = {}
        room_type.save(update_fields=["plan"])

        room_type.refresh_from_db()
        assert room_type.plan_level == RoomType.PlanLevel.FULL, (
            "уровень пересчитался по кадрам — значит он снова догадка"
        )


def test_dropping_only_the_night_frame_does_not_downgrade_either(crystal, room_type):
    """
    Тот же укус с другой стороны: полный тип без ночного кадра остаётся полным,
    а не «становится простым». Отсутствие кадра — это незаконченная работа, и
    сказать о ней должен редактор, а не молчаливое понижение услуги.
    """
    with tenant_context(crystal):
        plan = dict(room_type.plan or {})
        plan.pop("asset_off_id", None)
        room_type.plan = plan
        room_type.save(update_fields=["plan"])

        room_type.refresh_from_db()
        assert room_type.plan_level == RoomType.PlanLevel.FULL


def test_a_new_type_starts_as_tiles(crystal):
    """
    Умолчание — плашки: новый тип ещё ничего не купил и картинки не имеет.
    Начинать с «полного» значило бы обещать то, чего нет.
    """
    with tenant_context(crystal):
        fresh = RoomType.objects.create(hotel=crystal, code="fresh-type", title={"ru": "Новый"})
        assert fresh.plan_level == RoomType.PlanLevel.TILES


def test_the_backfill_rule_matches_what_the_type_used_to_show(crystal):
    """
    Правило миграции выписано ОДИН раз и проверяется здесь же: бэкфилл не имеет
    права поменять вид ни одному существующему типу.
    """
    # Модуль миграции начинается с цифры — обычный import его не возьмёт.
    import importlib

    level_for = importlib.import_module(
        "apps.grms.migrations.0006_roomtype_plan_level"
    ).level_for

    assert level_for({}) == "tiles"
    assert level_for({"asset_id": "a"}) == "simple"
    assert level_for({"asset_id": "a", "asset_off_id": "b"}) == "full"
    # Мусор вместо словаря — плашки, а не падение: миграция обязана пережить
    # любую строку, которая уже лежит в базе.
    assert level_for(None) == "tiles"
    assert level_for("сломано") == "tiles"


def test_setting_the_level_writes_the_journal_inside_the_tenant(crystal, room_type):
    """
    УКУС НА RLS. Смена уровня пишет журнал — и пишет его ИЗНУТРИ контекста.

    `core_audit_log` — тенантная таблица под политикой: вставка снаружи
    контекста не «проходит как-нибудь», а отбивается InsufficientPrivilege.
    Первая редакция писала журнал во вьюхе, уже после выхода из контекста, и
    падала только на пути платформенной консоли, где тенант не выставлен по
    умолчанию, — то есть ровно там, где эта ручка и живёт.
    """
    from apps.core.models import AuditLog
    from apps.grms.services import builder

    # Контекст НЕ выставлен снаружи — как в платформенной консоли.
    builder.set_plan_level(crystal, room_type_code=room_type.code, level="simple", actor_type=SYSTEM_ACTOR)

    with tenant_context(crystal):
        entry = AuditLog.objects.filter(action="grms.plan_level_changed").first()
        assert entry is not None, "смена уровня не попала в журнал"
        assert entry.payload["from"] == "full"
        assert entry.payload["to"] == "simple"
        assert RoomType.objects.get(pk=room_type.pk).plan_level == "simple"


def test_an_unknown_level_is_refused_before_anything_is_written(crystal, room_type):
    """Мусор в уровне — отказ, а не запись «чего-то» в базу и журнал."""
    from apps.core.errors import ValidationError
    from apps.grms.services import builder

    with pytest.raises(ValidationError):
        builder.set_plan_level(crystal, room_type_code=room_type.code, level="сломано", actor_type=SYSTEM_ACTOR)

    with tenant_context(crystal):
        assert RoomType.objects.get(pk=room_type.pk).plan_level == "full"
