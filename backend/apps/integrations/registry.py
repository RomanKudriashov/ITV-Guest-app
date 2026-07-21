"""
Выбор адаптеров. Одна точка, где имя из настроек превращается в объект, —
чтобы подключение реальной PMS/эквайринга было изменением конфигурации, а не
правкой прикладного кода.
"""

from __future__ import annotations

import functools

from django.conf import settings

from .payments.base import NullPaymentAdapter
from .pms.base import NullPMSAdapter

PMS_ADAPTERS = {"null": NullPMSAdapter}
PAYMENT_ADAPTERS = {"null": NullPaymentAdapter}


@functools.lru_cache(maxsize=None)
def get_pms_adapter(name: str | None = None):
    key = name or settings.PMS_ADAPTER
    try:
        return PMS_ADAPTERS[key]()
    except KeyError:
        raise ImproperlyConfiguredAdapter(f"Неизвестный PMS-адаптер: {key}") from None


@functools.lru_cache(maxsize=None)
def get_payment_adapter(name: str | None = None):
    key = name or settings.PAYMENT_ADAPTER
    try:
        return PAYMENT_ADAPTERS[key]()
    except KeyError:
        raise ImproperlyConfiguredAdapter(f"Неизвестный платёжный адаптер: {key}") from None


class ImproperlyConfiguredAdapter(Exception):
    pass
