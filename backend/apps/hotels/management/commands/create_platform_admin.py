"""
Завести супер-админа платформы (для входа в консоль /admin на базовом домене).

Адрес был /platform до переезда схемы адресов; корень базового домена теперь
занимает лендинг, консоль живёт на /admin, и с адреса отеля её нет вовсе.

    manage.py create_platform_admin --email=platform@example.com --password=…

Создаётся через платформенную роль (BYPASSRLS): у такого пользователя
hotel = NULL, и роль приложения его не видит.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand

from apps.hotels.services.provisioning import ensure_platform_admin


class Command(BaseCommand):
    help = "Создать/обновить супер-админа платформы"

    def add_arguments(self, parser):
        parser.add_argument("--email", required=True)
        parser.add_argument("--password", required=True)

    def handle(self, *args, **opts):
        user = ensure_platform_admin(email=opts["email"], password=opts["password"])
        self.stdout.write(self.style.SUCCESS(f"Платформенный админ готов: {user.email}"))
