"""
СТОРОЖ: сервисы GRMS зовутся БЕЗ ОКРУЖАЮЩЕГО ТЕНАНТ-КОНТЕКСТА.

Ровно так их зовёт платформенный путь. У запроса в консоль «текущего отеля»
нет вовсе: отель назван в адресе, middleware поддомена там не работает, и
тенанта обязан выставить сам сервис.

ЧЕМ ЭТО ОПАСНО. Тенантные таблицы под RLS на запрос без выставленного тенанта
возвращают НОЛЬ СТРОК, а не ошибку. Сервис отвечает `200`, поле приходит
пустым, экран честно рисует «данных нет» — и выглядит это как несработавшее
действие, а не как отказ прав.

ЧЕТЫРЕ РАЗА ПОДРЯД мы ловили это глазами и поздно:

  миграция 0021 — под обычной ролью отчиталась «OK», не тронув ни строки;
  журнал аудита — писался во вьюхе, уже после выхода из контекста;
  миграция 0023 — тот же обход по отелям понадобился снова;
  выдача плана — `frame_payload` вызывался в собираемом ответе, за пределами
    блока: в CMS работало (окружение держало тенанта), в консоли молча
    возвращало `null`.

Пятый раз означает, что глазами мы это ловить перестали. Здесь оно проверяется
ВЫЗОВОМ: тест сравнивает ответ сервиса, позванного без окружения, с ответом
того же сервиса внутри контекста. Разошлись — значит сервис полагается на
окружение, которого у половины его вызывающих нет.
"""

from __future__ import annotations

import pytest

from apps.core.context import tenant_context
from apps.grms.models import RoomType

pytestmark = pytest.mark.django_db


@pytest.fixture
def furnished(crystal):
    """
    Тип с НАСТОЯЩИМ кадром плана. Заводим его сами, а не ищем в сиде.

    Сторож, который пропускает себя при нехватке данных, не сторожит ничего:
    именно в таком виде он и молчал бы про дефект, ради которого написан.
    Кадр нужен настоящий: пустой `asset_id` вернул бы `None` в обоих случаях,
    и расхождение стало бы невидимым.
    """
    from apps.media.models import MediaAsset
    from apps.media.services import upload_asset

    with tenant_context(crystal):
        asset = upload_asset(
            content=_png_bytes(),
            filename="plan.png",
            kind=MediaAsset.Kind.ROOM_PLAN,
            content_type="image/png",
            alt={"ru": "План"},
        )
        room_type = RoomType.objects.create(
            hotel=crystal,
            code="ambient-suite",
            title={"ru": "Проверочный"},
            plan={"asset_id": str(asset.pk), "aspect": 1.6, "zones": []},
            plan_level=RoomType.PlanLevel.SIMPLE,
        )
        return room_type.code


def _png_bytes() -> bytes:
    """Настоящий PNG: медиапайплайн читает его, а не считает байты."""
    import io

    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (64, 40), (200, 200, 200)).save(buffer, format="PNG")
    return buffer.getvalue()


# Поля, которые меняются САМИ между двумя вызовами: момент замера берётся в
# момент вызова, и два вызова подряд законно дадут разные значения. Сравнивать
# их значит завести сторож, который краснеет без причины, — а такой выключают.
VOLATILE = {"checked_at", "generated_at", "server_time"}


def _stable(value):
    """Ответ без изменчивых полей — рекурсивно, на любой глубине."""
    if isinstance(value, dict):
        return {k: _stable(v) for k, v in value.items() if k not in VOLATILE}
    if isinstance(value, list):
        return [_stable(item) for item in value]
    return value


def _both_ways(call, crystal):
    """
    Позвать сервис ДВАЖДЫ: снаружи контекста и внутри него.

    Внутри — эталон: так его зовёт CMS, где тенанта держит middleware.
    Снаружи — платформенный путь. Ответы обязаны совпасть.
    """
    outside = call()
    with tenant_context(crystal):
        inside = call()
    return _stable(outside), _stable(inside)


def test_plan_payload_returns_the_frames_without_ambient_tenant(crystal, furnished):
    """
    УКУС, ради которого сторож и заведён.

    `MediaAsset` тенантная: собранные за пределами блока кадры приходили
    пустыми, и редактор плана в консоли говорил «кадра ещё нет» на принятый
    сервером кадр.
    """
    from apps.grms.services import plan_editor

    outside, inside = _both_ways(lambda: plan_editor.payload(crystal, furnished), crystal)

    assert outside["frames"] == inside["frames"], (
        "кадры плана разошлись: без окружающего тенанта сервис отдал не то же, "
        "что внутри контекста — значит он на это окружение полагается"
    )
    assert outside["frames"]["lit"], "светлый кадр пропал вне контекста"


def test_plan_payload_agrees_completely_without_ambient_tenant(crystal, furnished):
    """Не только кадры: весь ответ обязан совпасть до последнего поля."""
    from apps.grms.services import plan_editor

    outside, inside = _both_ways(lambda: plan_editor.payload(crystal, furnished), crystal)
    assert outside == inside


def test_types_listing_agrees_without_ambient_tenant(crystal, furnished):
    from apps.grms.services import builder

    outside, inside = _both_ways(lambda: builder.list_types_with_variables(crystal), crystal)
    assert outside == inside
    # Пусто ОБА раза — это не «сходится», это «нечего сравнивать»: без данных
    # сторож промолчал бы и о настоящем расхождении.
    assert outside, "список типов пуст — сравнивать нечего"


def test_type_status_agrees_without_ambient_tenant(crystal, furnished):
    from apps.grms.services import builder

    outside, inside = _both_ways(lambda: builder.type_status(crystal, furnished), crystal)
    assert outside == inside


def test_publishing_history_agrees_without_ambient_tenant(crystal, furnished):
    from apps.grms.services import publishing

    outside, inside = _both_ways(lambda: publishing.history(crystal, furnished), crystal)
    assert outside == inside


def test_published_config_agrees_without_ambient_tenant(crystal, furnished):
    from apps.grms.services import publishing

    outside, inside = _both_ways(
        lambda: (publishing.current(crystal, furnished) or None) and
        publishing.current(crystal, furnished).payload,
        crystal,
    )
    assert outside == inside


def test_access_state_agrees_without_ambient_tenant(crystal):
    """Доступ гостя остаётся в CMS, но правило одно на всех сервисов."""
    from apps.grms.services import access as access_svc

    outside, inside = _both_ways(lambda: access_svc.list_room_pins(crystal), crystal)
    assert outside == inside


def test_diagnostics_journal_agrees_without_ambient_tenant(crystal):
    from apps.grms.services import diagnostics

    outside, inside = _both_ways(lambda: diagnostics.journal(crystal), crystal)
    assert outside == inside


def test_link_state_agrees_without_ambient_tenant(crystal):
    from apps.grms.services import diagnostics

    outside, inside = _both_ways(lambda: diagnostics.link_state(crystal), crystal)
    assert outside == inside
