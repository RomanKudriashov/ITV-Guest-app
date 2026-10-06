"""
АДРЕС → ОТЕЛЬ ИЛИ ПЛАТФОРМА (партия 39: несколько баз).

Одно правило на HTTP (`TenantMiddleware`) и сокеты (`realtime.consumers`):

  * `<код>.<любая база>` — отель по коду;
  * `<база>` — платформа (консоль, лендинг);
  * адрес машины разработчика (одна метка, `localhost`, IP, `*.local`) —
    платформа, как было: тесты и дев ходят так и выбирают отель заголовком;
  * любой другой адрес — ТОЛЬКО явный `custom_domain` отеля. Раньше чужой
    адрес отдавал свою первую метку: `crystal.чужой-домен.ru` находил
    «Кристалл». Теперь чужой домен не находит ничего.
"""

from __future__ import annotations

import ipaddress

from django.conf import settings


def normalize(host: str) -> str:
    return (host or "").split(":", 1)[0].lower().strip().strip(".")


def bases() -> list[str]:
    """Базы, длинные первыми: `a.b.ru` не должна прятаться за `b.ru`."""
    return sorted(settings.GUEST_APP_BASE_DOMAINS, key=len, reverse=True)


def is_developer_host(host: str) -> bool:
    host = normalize(host)
    if not host or "." not in host or host == "localhost" or host.endswith(".local"):
        return True
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return False
    return True


def resolve_subdomain(host: str) -> str | None:
    """Код отеля, если адрес — `<код>.<одна из баз>`; иначе None."""
    host = normalize(host)
    for base in bases():
        if host.endswith("." + base):
            code = host[: -(len(base) + 1)].split(".")[-1]
            if code and code not in settings.GUEST_APP_RESERVED_SUBDOMAINS:
                return code
            return None
    return None


def is_platform_host(host: str) -> bool:
    """Здесь живёт консоль: сама база или машина разработчика."""
    host = normalize(host)
    return host in settings.GUEST_APP_BASE_DOMAINS or is_developer_host(host)


def custom_domain_hotel(host: str):
    """Отель по собственному домену — только явная запись `custom_domain`."""
    from apps.hotels.models import Hotel

    host = normalize(host)
    if not host or is_platform_host(host) or resolve_subdomain(host):
        return None
    return Hotel.objects.filter(custom_domain=host, is_active=True).first()
