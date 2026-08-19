"""
Навигация CMS и её гейтинг модулями (R4).

До R4 меню было плоской простынёй из 16 пунктов, одинаковой у всех отелей, а
реестр модулей (R1) ни на что не влиял.

Первый тест здесь — сторож против самой опасной ошибки гейтинга: привязать к
платному модулю пункт, без которого отель не работает. Такой пункт молча
исчезнет у всех, кто за модуль не платил, и это будет выглядеть как поломка,
а не как тариф.
"""

from __future__ import annotations

import pytest

from apps.core.context import tenant_context
from apps.hotels.services.cms_navigation import ALWAYS_AVAILABLE, NAVIGATION
from apps.hotels.models import HotelModule

pytestmark = pytest.mark.django_db


def groups_of(payload) -> dict[str, list[str]]:
    return {g["key"]: [i["key"] for i in g["items"]] for g in payload["groups"]}


# --- Сторож гейтинга -------------------------------------------------------


def test_base_sections_are_never_gated_by_a_module():
    """
    Модуль — платная надстройка, а не выключатель для базового инструмента.
    Меню, номера, персонал, бренд, аналитика и настройки есть у всех.
    """
    gated = {
        item.key
        for group in NAVIGATION
        for item in group.items
        if item.module is not None
    }
    assert not (gated & ALWAYS_AVAILABLE), (
        "базовый раздел привязан к модулю — отель останется без того, "
        "за что уже заплатил тарифом"
    )


def test_every_gated_item_names_a_real_module():
    valid = {code.value for code in HotelModule.Code}
    for group in NAVIGATION:
        for item in group.items:
            if item.module is not None:
                assert item.module in valid, item.key


# --- Группы вместо простыни ------------------------------------------------


def test_navigation_is_grouped_not_flat(cms):
    payload = cms.get("/api/cms/navigation").json()
    groups = groups_of(payload)

    assert list(groups) == [
        "operations",
        "structure",
        "storefront",
        "settings",
    ], "четыре группы карты продукта, в этом порядке"

    # Оперативное — вместе, включая уведомления: на них смотрят в смену, а не
    # настраивают раз и забывают.
    assert groups["operations"] == ["dashboard", "tracker", "notifications"]
    # Структура карты продукта: сервисы верхним уровнем, номерной фонд, персонал.
    # Управления номером здесь нет — модуль отелю не включён.
    assert groups["structure"] == ["services", "rooms", "staff"]
    # «Бренд и витрина» — один пункт, а не два. Маркетинг гейтится модулем.
    assert groups["storefront"] == ["brand", "analytics"]
    assert groups["settings"] == ["settings", "dictionaries"]


def test_no_group_is_named_after_the_price_list(cms):
    """
    УКУС. Группа «Модули» собирала пункты по СПОСОБУ ПРОДАЖИ: оплата,
    управление номером и маркетинг лежали вместе только потому, что за них
    доплачивают. Админ, которому нужна оплата, идёт в «Настройки», а не в «за
    что мы платим», — и не находил.

    Заодно сторож против возврата групп из одного пункта: заголовок обязан
    сокращать перебор, а над единственной строкой он его удваивает.
    """
    groups = groups_of(cms.get("/api/cms/navigation").json())

    assert "modules" not in groups, "группировка по прайсу вернулась"
    for key, items in groups.items():
        assert len(items) >= 2, f"группа «{key}» из одного пункта — заголовок впустую"


def test_no_standalone_commerce_section(cms):
    """
    Коммерция растворена: валюта и налог — в настройках отеля, коммерция
    заведения — на его вкладке. Отдельного пункта быть не должно.
    """
    keys = {i["key"] for g in cms.get("/api/cms/navigation").json()["groups"] for i in g["items"]}
    assert "commerce" not in keys
    assert "showcase" not in keys, "витрина слита с брендом"
    assert "locations" not in keys, "локации переехали в настройки отеля"


# --- Гейтинг ---------------------------------------------------------------


def test_module_off_hides_its_section(cms):
    keys = {i["key"] for g in cms.get("/api/cms/navigation").json()["groups"] for i in g["items"]}
    assert "marketing" not in keys


def test_module_on_reveals_its_section(cms, crystal):
    with tenant_context(crystal):
        HotelModule.objects.update_or_create(
            code=HotelModule.Code.MARKETING, defaults={"is_enabled": True}
        )

    groups = groups_of(cms.get("/api/cms/navigation").json())
    # Модульный пункт приходит В СВОЮ группу по предмету, а не в резервацию
    # «Модули»: маркетинг — это про то, что видит гость.
    assert groups["storefront"] == ["brand", "marketing", "analytics"]


def test_disabling_the_module_hides_it_again(cms, crystal):
    with tenant_context(crystal):
        HotelModule.objects.update_or_create(
            code=HotelModule.Code.MARKETING, defaults={"is_enabled": True}
        )
    assert "marketing" in groups_of(cms.get("/api/cms/navigation").json())["storefront"]

    with tenant_context(crystal):
        HotelModule.objects.filter(code=HotelModule.Code.MARKETING).update(is_enabled=False)

    groups = groups_of(cms.get("/api/cms/navigation").json())
    assert "marketing" not in groups["storefront"]
    # А сама группа осталась: в ней есть и небазовые пункты.
    assert groups["storefront"] == ["brand", "analytics"]


def test_a_group_left_without_items_disappears_entirely(cms_manager, crystal):
    """
    УКУС ПУНКТА 1: выключенный модуль не должен оставлять пустой заголовок.

    Проверяется на управляющем сервисом, и это не случайный выбор — именно у
    него группа может опустеть ЦЕЛИКОМ. В «Настройках» все пять пунктов либо
    только для админа отеля, либо ещё и за модулем: управляющему не положен ни
    один. Раньше группу спасали «Уведомления», которые в ней лежали; после
    переноса их в «Оперативно» спасать нечем — и группа обязана исчезнуть, а не
    остаться заголовком над пустотой.

    Модули при этом включены: доказываем, что группа пуста по ПРАВАМ, а не
    потому, что нам просто нечего было показать.
    """
    with tenant_context(crystal):
        for code in (HotelModule.Code.PAYMENT, HotelModule.Code.PMS):
            HotelModule.objects.update_or_create(code=code, defaults={"is_enabled": True})

    groups = groups_of(cms_manager.get("/api/cms/navigation").json())

    assert "settings" not in groups, "пустая группа осталась заголовком над пустотой"
    assert groups, "у управляющего должны остаться его группы"
    for key, items in groups.items():
        assert items, f"группа «{key}» пришла пустой"


# --- Роль ------------------------------------------------------------------


def test_manager_sees_only_what_he_can_change(cms_manager):
    """
    Управляющий распоряжается своим заведением, а не отелем: номерной фонд,
    бренд, справочники и настройки отеля ему не показываем — рисовать пункт,
    который ответит 403, значит врать интерфейсом.
    """
    groups = groups_of(cms_manager.get("/api/cms/navigation").json())
    keys = {key for items in groups.values() for key in items}

    assert "services" in keys and "staff" in keys and "analytics" in keys
    assert "rooms" not in keys
    assert "brand" not in keys
    assert "settings" not in keys
    assert "storefront" in groups and groups["storefront"] == ["analytics"], (
        "управляющему из витрины положена только аналитика: бренд — админский"
    )


def test_line_staff_has_no_navigation_at_all(cms_line_staff):
    assert cms_line_staff.get("/api/cms/navigation").status_code == 403
