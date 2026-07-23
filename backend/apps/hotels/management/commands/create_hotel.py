"""
Завести новый отель на платформенном уровне.

    manage.py create_hotel --subdomain=grand --name="Grand Hotel" \
        --admin-email=admin@grand.example [--tz=Europe/Moscow --currency=RUB \
         --languages=ru,en --preset=midnight_navy --admin-password=…]

Создаёт минимальный рабочий каркас (см. apps/hotels/provisioning.py) и выводит
доступ администратора ОДИН РАЗ. Дальше hotel-admin входит в CMS на поддомене и
настраивает меню, номера и остальное.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError

from apps.core.errors import DomainError
from apps.hotels.provisioning import DEFAULT_PRESET, provision_hotel


class Command(BaseCommand):
    help = "Создать новый отель (каркас тенанта) на платформенном уровне"

    def add_arguments(self, parser):
        parser.add_argument("--subdomain", required=True)
        parser.add_argument("--name", required=True)
        parser.add_argument("--admin-email", required=True, dest="admin_email")
        parser.add_argument("--tz", default="Europe/Moscow")
        parser.add_argument("--currency", default="RUB")
        parser.add_argument("--languages", default="ru,en", help="через запятую, первый — язык по умолчанию")
        parser.add_argument("--preset", default=DEFAULT_PRESET)
        parser.add_argument("--admin-password", dest="admin_password", default=None,
                            help="если не задан — сгенерируется и покажется один раз")

    def handle(self, *args, **opts):
        try:
            result = provision_hotel(
                subdomain=opts["subdomain"],
                name=opts["name"],
                admin_email=opts["admin_email"],
                timezone=opts["tz"],
                currency=opts["currency"],
                languages=[c for c in opts["languages"].split(",") if c.strip()],
                preset=opts["preset"],
                admin_password=opts["admin_password"],
                exist_ok=False,
            )
        except DomainError as exc:
            # Чистая ошибка вместо трейсбека; транзакция уже откатилась —
            # полу-созданного отеля не остаётся.
            raise CommandError(str(exc)) from exc

        hotel = result.hotel
        self.stdout.write(self.style.SUCCESS(f"Отель «{hotel.name}» создан."))
        self.stdout.write(f"  Поддомен:      {hotel.subdomain}")
        self.stdout.write(f"  Витрина:       https://{hotel.subdomain}.<домен>/")
        self.stdout.write(f"  CMS-логин:     {result.admin.email}")
        if result.admin_password:
            self.stdout.write(self.style.WARNING(
                f"  Пароль (один раз): {result.admin_password}"
            ))
        self.stdout.write("Дальше: hotel-admin входит в CMS на поддомене и настраивает меню/номера.")
