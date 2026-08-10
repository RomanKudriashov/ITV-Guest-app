"""
Флот из трёх отелей: «Кристалл» + курорт «Азур» + бутик «Люмен».

Проверяем не «сид отработал», а то, ради чего он существует: три отеля РАЗНЫЕ
и не видят друг друга. Одинаковые отели не доказывают мультитенантность —
доказывает непохожий сосед, которому чужие данные недоступны.
"""

from __future__ import annotations

import pytest
from django.core.management import call_command

from apps.catalog.models import Category, Item, ServiceInclusion
from apps.core.context import tenant_context
from apps.hotels.models import Hotel, Room, Service

pytestmark = pytest.mark.django_db


@pytest.fixture
def fleet(crystal):
    """«Кристалл» из общего сида плюс два отеля флота."""
    call_command("seed_demo_fleet", verbosity=0)
    return {
        "crystal": crystal,
        "azure": Hotel.objects.get(subdomain="azure"),
        "lumen": Hotel.objects.get(subdomain="lumen"),
    }


def _codes(hotel) -> set[str]:
    with tenant_context(hotel):
        return {service.code for service in Service.objects.all()}


def test_fleet_hotels_are_different_not_copies(fleet):
    """
    Курорт и бутик отличаются составом, а не только вывеской.

    Если бы отели были копиями, сравнение наборов заведений дало бы равенство —
    и вся демонстрация white-label свелась бы к другому цвету кнопки.
    """
    azure, lumen = _codes(fleet["azure"]), _codes(fleet["lumen"])

    assert azure != lumen
    # Курорт крупнее бутика — это и есть «разный масштаб».
    assert len(azure) > len(lumen)
    # У курорта есть то, чего у бутика нет вовсе: спа и экскурсии (слоты).
    assert {"thalasso", "excursions"} <= azure
    assert not {"thalasso", "excursions"} & lumen
    # А у бутика — свой винный бар, которого нет на курорте.
    assert "wine-bar" in lumen and "wine-bar" not in azure


def test_each_fleet_hotel_has_its_own_brand(fleet):
    """Три отеля — три пресета. Общий бренд означал бы отсутствие white-label."""
    from apps.hotels.models import BrandTheme

    presets = {}
    for name, hotel in fleet.items():
        # Тема тенант-скоупная: снаружи контекста менеджер её не отдаст.
        with tenant_context(hotel):
            theme = BrandTheme.objects.filter(pk=hotel.default_theme_id).first()
        assert theme is not None, f"у отеля «{name}» нет темы"
        presets[name] = (theme.tokens or {}).get("preset")
    assert len(set(presets.values())) == 3, presets


def test_room_service_borrows_the_restaurant(fleet):
    """
    Кросс-ссылка с наценкой в КАЖДОМ отеле флота.

    Рум-сервис своего меню не имеет: позиция живёт в ресторане, а видна в двух
    местах. Это главный механизм модели, и он обязан работать не только в
    отеле, на котором его писали.
    """
    for subdomain, source, markup in [("azure", "marina", 1500), ("lumen", "bistro", 1000)]:
        with tenant_context(fleet[subdomain]):
            inclusion = ServiceInclusion.objects.select_related(
                "including_service", "source_service"
            ).get(source_service__code=source)
            assert inclusion.including_service.code.endswith("room-service")
            assert inclusion.markup_value == markup
            assert inclusion.executor == ServiceInclusion.Executor.SOURCE, (
                "заказ обязан уезжать на доску РЕСТОРАНА, а не рум-сервиса"
            )


def test_fleet_covers_all_four_content_types(fleet):
    """
    Курорт покрывает модель целиком: товары, заявки, слоты и инфо.

    Ради этого он и заводится крупным: отель, где есть только меню, ничего не
    говорит о том, держит ли модель остальные три типа.
    """
    with tenant_context(fleet["azure"]):
        types = set(Category.objects.filter(is_active=True).values_list("type", flat=True))
    assert {"product", "service_request", "slot", "info"} <= types, types


def test_tenants_do_not_see_each_other(fleet):
    """
    ГЛАВНОЕ. Заведения и позиции одного отеля не видны из другого.

    Утечка здесь — не косметика: это чужие меню, чужие заказы и чужая выручка.
    """
    with tenant_context(fleet["azure"]):
        assert not Service.objects.filter(code="bistro").exists(), "виден бутик"
        assert not Service.objects.filter(code="kitchen").exists(), "виден «Кристалл»"

    with tenant_context(fleet["lumen"]):
        assert not Service.objects.filter(code="marina").exists(), "виден курорт"
        # Позиции курорта, которых у бутика нет, не должны быть видны.
        assert not Item.objects.filter(code="boat-trip").exists()

    with tenant_context(fleet["crystal"]):
        assert not Service.objects.filter(code="marina").exists()
        assert not Service.objects.filter(code="bistro").exists()

    # Один и тот же КОД блюда в разных отелях — РАЗНЫЕ строки, а не общая.
    # Сравниваем курорт с «Кристаллом»: меню курорта и бутика намеренно не
    # пересекаются, а вот с «Кристаллом» общие блюда есть, и это тот случай,
    # ради которого проверка написана.
    with tenant_context(fleet["azure"]):
        azure_items = set(Item.objects.values_list("code", flat=True))
    with tenant_context(fleet["crystal"]):
        crystal_items = set(Item.objects.values_list("code", flat=True))
    shared = azure_items & crystal_items
    assert shared, "курорт и «Кристалл» обязаны делить часть блюд — иначе проверка пустая"
    for code in shared:
        with tenant_context(fleet["azure"]):
            azure_row = Item.objects.get(code=code).pk
        with tenant_context(fleet["crystal"]):
            crystal_row = Item.objects.get(code=code).pk
        assert azure_row != crystal_row, f"«{code}» — одна строка на два отеля"


def test_seed_is_idempotent(fleet):
    """Повторный запуск ничего не удваивает — иначе стенд разъедется за пару прогонов."""
    def snapshot():
        counts = {}
        for subdomain in ("azure", "lumen"):
            with tenant_context(fleet[subdomain]):
                counts[subdomain] = (
                    Service.objects.count(),
                    Category.objects.count(),
                    Item.objects.count(),
                    Room.objects.count(),
                )
        return counts

    before = snapshot()
    call_command("seed_demo_fleet", verbosity=0)
    assert snapshot() == before


def test_module_settings_survive_a_registry_switch(crystal):
    """
    Переключение модуля НЕ стирает его настройки.

    Реестр перезаписывал `config` целиком, и запрос без него молча очищал
    конфигурацию. В управлении номером там лежит флаг демо-входа: один заход в
    платформенную консоль перед показом — и гость упирается в PIN, которого
    никто не знает.
    """
    from apps.core.context import tenant_context
    from apps.hotels.models import HotelModule
    from apps.hotels import module_registry

    with tenant_context(crystal):
        HotelModule.objects.update_or_create(
            code=HotelModule.Code.ROOM_CONTROL,
            defaults={
                "is_enabled": True,
                "source": HotelModule.Source.OVERRIDE,
                "config": {"guest_entry_demo": True},
            },
        )

    # Запрос БЕЗ config — «поменяй включённость, настройки не трогай».
    module_registry.set_modules(
        crystal, [{"code": HotelModule.Code.ROOM_CONTROL, "is_enabled": True}]
    )
    with tenant_context(crystal):
        module = HotelModule.objects.get(code=HotelModule.Code.ROOM_CONTROL)
    assert module.config.get("guest_entry_demo") is True, "настройки модуля стёрты переключением"

    # Присланный ключ сливается с существующими, а не заменяет их целиком.
    module_registry.set_modules(
        crystal,
        [{"code": HotelModule.Code.ROOM_CONTROL, "is_enabled": True, "config": {"note": "показ"}}],
    )
    with tenant_context(crystal):
        module = HotelModule.objects.get(code=HotelModule.Code.ROOM_CONTROL)
    assert module.config == {"guest_entry_demo": True, "note": "показ"}
