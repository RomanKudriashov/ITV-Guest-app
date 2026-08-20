"""
Модель сервиса (R1): типизированный контейнер над исполнителем.

Проверяем гостевую идентичность с фолбэком на имя исполнителя, наследование
коммерции от отеля через оверрайды, инвариант 1:1 сервис↔исполнитель, RLS-
изоляцию новых таблиц и реестр модулей.
"""

from __future__ import annotations

import pytest
from django.db import IntegrityError, transaction

from apps.core.context import tenant_context
from apps.hotels.models import ExecutionPoint, HotelModule, Service

pytestmark = pytest.mark.django_db


def _make_service(*, code: str = "grill", **overrides) -> Service:
    ep = ExecutionPoint.objects.create(
        code=code,
        title={"ru": "Гриль-кухня", "en": "Grill kitchen"},
        kind=ExecutionPoint.Kind.KITCHEN,
    )
    return Service.objects.create(
        execution_point=ep,
        code=code,
        type=Service.Type.RESTAURANT,
        **overrides,
    )


def test_public_title_falls_back_to_executor_title(crystal):
    with tenant_context(crystal):
        svc = _make_service(public_name={})
        # Пустое public_name → падаем на служебное имя исполнителя.
        assert svc.public_title == {"ru": "Гриль-кухня", "en": "Grill kitchen"}
        svc.public_name = {"ru": "Панорама", "en": "Panorama"}
        assert svc.public_title == {"ru": "Панорама", "en": "Panorama"}


def test_commerce_value_inherits_hotel_then_overrides(crystal):
    crystal.service_fee_bp = 1000
    crystal.save(update_fields=["service_fee_bp", "updated_at"])
    with tenant_context(crystal):
        svc = _make_service()  # оверрайд null → наследуем отель
        assert svc.commerce_value(crystal, "service_fee_bp") == 1000
        svc.service_fee_bp = 1500
        assert svc.commerce_value(crystal, "service_fee_bp") == 1500
        # 0 — валидный оверрайд «сбор выключен», а не «наследовать».
        svc.service_fee_bp = 0
        assert svc.commerce_value(crystal, "service_fee_bp") == 0


def test_one_service_per_execution_point(crystal):
    with tenant_context(crystal):
        ep = ExecutionPoint.objects.create(
            code="pool_bar", title={"ru": "Бар у бассейна"}, kind=ExecutionPoint.Kind.BAR
        )
        Service.objects.create(execution_point=ep, code="pool_bar", type=Service.Type.BAR)
        with pytest.raises(IntegrityError):
            with transaction.atomic():
                Service.objects.create(
                    execution_point=ep, code="pool_bar_2", type=Service.Type.BAR
                )


def test_service_rls_isolation_between_hotels(crystal, aurora):
    with tenant_context(crystal):
        _make_service(code="crystal_only")
        assert Service.objects.filter(code="crystal_only").exists()
    with tenant_context(aurora):
        assert not Service.objects.filter(code="crystal_only").exists()


def test_hotel_module_registry(crystal):
    with tenant_context(crystal):
        enabled = HotelModule.objects.create(
            code=HotelModule.Code.MULTI_RESTAURANT,
            is_enabled=True,
        )
        # Намерения нет — модуль просто следует за тарифом.
        assert enabled.is_enabled and enabled.intent == ""
        override = HotelModule.objects.create(
            code=HotelModule.Code.PMS,
            is_enabled=True,
            intent=HotelModule.Intent.ON,
            config={"node": "local-1"},
        )
        assert override.intent == "on" and override.config["node"] == "local-1"
        with pytest.raises(IntegrityError):
            with transaction.atomic():
                HotelModule.objects.create(code=HotelModule.Code.MULTI_RESTAURANT)
