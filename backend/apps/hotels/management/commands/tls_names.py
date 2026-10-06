"""
Имена для сертификата стенда — из баз и отелей (партия 39).

    python manage.py tls_names

Печатает по одному имени в строке: каждую базу адресов (`APP_DOMAINS`) и
каждый действующий отель под каждой базой, плюс собственные домены отелей.
Wildcard на этих доменах не выпустить (а на sslip.io и не нужен), поэтому
сертификат выписывается на список — и список не пишется руками:
`infra/nginx/enable-tls.sh` берёт его отсюда, новый отель попадает в него сам.
Резолвится ли имя — проверяет скрипт: здесь только то, что МЫ обслуживаем.
"""

from __future__ import annotations

from django.conf import settings
from django.core.management.base import BaseCommand

from apps.core.context import platform_scope


def certificate_names() -> list[str]:
    from apps.hotels.models import Hotel

    with platform_scope():
        hotels = list(
            Hotel.all_objects.using("platform")
            .filter(is_active=True, deleted_at__isnull=True)
            # Отели автотестов в сертификат не идут: у Let's Encrypt предел —
            # 100 имён, и прогоны его бы съели.
            .exclude(origin=Hotel.Origin.TEST)
            .order_by("subdomain")
            .values_list("subdomain", "custom_domain")
        )
    names: list[str] = []
    for base in settings.GUEST_APP_BASE_DOMAINS:
        names.append(base)
        names += [f"{subdomain}.{base}" for subdomain, _ in hotels if subdomain]
    names += [domain.lower() for _, domain in hotels if domain]
    unique: list[str] = []
    for name in names:
        if name not in unique:
            unique.append(name)
    return unique


class Command(BaseCommand):
    help = "Имена для сертификата: базы и действующие отели под каждой базой"

    def handle(self, *args, **options):
        for name in certificate_names():
            self.stdout.write(name)
