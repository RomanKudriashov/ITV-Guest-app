"""
Сбросить второй фактор учётке NaviRoom Control (партия 60).

    manage.py reset_platform_2fa --email=owner@example.com

Выход для того, у кого сбросить некому: единственный владелец потерял
телефон с приложением, и войти в консоль, чтобы снять фактор, он не может.
Другому участнику владелец сбрасывает фактор в «Пользователях»; себе — только
так, на сервере, где доступ уже подтверждён другим способом.

Секрет стирается, входы учётки обрываются, действие уходит в журнал
платформы. В вывод — только «сброшено для <email>»: ни секрета, ни кодов.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError

from apps.core.errors import NotFoundError


class Command(BaseCommand):
    help = "Сбросить второй фактор (2FA) учётке NaviRoom Control"

    def add_arguments(self, parser):
        parser.add_argument("--email", required=True)

    def handle(self, *args, **opts):
        from apps.hotels.services.platform import console
        from apps.hotels.services.platform.team import reset_two_factor

        try:
            member = reset_two_factor(email=opts["email"])
        except NotFoundError as exc:
            raise CommandError(f"Учётка Control «{opts['email']}» не найдена") from exc
        console.audit_platform(
            "platform.2fa.reset",
            payload={"email": member.email, "via": "manage.py reset_platform_2fa"},
        )
        self.stdout.write(f"сброшено для {member.email}")
