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
from apps.hotels.cms_navigation import ALWAYS_AVAILABLE, NAVIGATION
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
        "appearance",
        "analytics",
        "settings",
    ], "модули отелю не включены — группы «Модули» быть не должно"

    # Структура карты продукта: сервисы верхним уровнем, номерной фонд, персонал.
    assert groups["structure"] == ["services", "rooms", "staff"]
    # «Бренд и витрина» — один пункт, а не два.
    assert groups["appearance"] == ["brand"]


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
    assert "modules" in groups
    assert "marketing" in groups["modules"]


def test_disabling_the_module_hides_it_again(cms, crystal):
    with tenant_context(crystal):
        HotelModule.objects.update_or_create(
            code=HotelModule.Code.MARKETING, defaults={"is_enabled": True}
        )
    assert "modules" in groups_of(cms.get("/api/cms/navigation").json())

    with tenant_context(crystal):
        HotelModule.objects.filter(code=HotelModule.Code.MARKETING).update(is_enabled=False)

    assert "modules" not in groups_of(cms.get("/api/cms/navigation").json())


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
    assert "appearance" not in groups, "пустая группа — это шум"


def test_line_staff_has_no_navigation_at_all(cms_line_staff):
    assert cms_line_staff.get("/api/cms/navigation").status_code == 403
