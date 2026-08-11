"""
Усиленный доступ к корневой админке: IP-allowlist и роли команды платформы.

/admin — мастер-ключ ко ВСЕМ отелям: один вошедший сюда видит и правит данные
каждого тенанта. Поэтому к обычной аутентификации добавлен рубеж «откуда
пришли» — allowlist сетей.

Про второй фактор: бэкенд его умеет целиком (`totp.py`, эндпоинты
`/platform/auth/2fa/*`), а вход его уважает — у кого `totp_enabled`, тот без
кода не пройдёт. Но включить 2FA из продукта пока НЕЛЬЗЯ: экрана управления
в консоли нет, и `totp_enabled` выставляется только руками. Считать 2FA
действующим рубежом до доводки консоли нельзя — фактически рубеж один.

Рубеж не заменяет существующую авторизацию, а надстраивается над ней —
`PlatformAuth` по-прежнему остаётся единственным местом, где решается «пустить
ли»; расхождения двух источников правды здесь нет.
"""

from __future__ import annotations

import ipaddress
import logging

from django.conf import settings
from django.http import HttpRequest

logger = logging.getLogger(__name__)


def allowlist() -> list[str]:
    """Разрешённые сети из настроек. Пустой список = ограничения нет."""
    return [entry for entry in getattr(settings, "PLATFORM_IP_ALLOWLIST", []) if entry]


def client_ip(request: HttpRequest) -> str | None:
    """
    IP клиента. За обратным прокси берём ПЕРВЫЙ адрес X-Forwarded-For — он от
    клиента, остальные дописаны прокси по пути; доверять последнему значит
    пускать по адресу собственного балансировщика.
    """
    forwarded = (request.META.get("HTTP_X_FORWARDED_FOR") or "").split(",")
    candidate = forwarded[0].strip() if forwarded and forwarded[0].strip() else None
    return candidate or request.META.get("REMOTE_ADDR")


def ip_allowed(request: HttpRequest) -> bool:
    """
    Проходит ли адрес allowlist.

    Пустой allowlist пускает всех — осознанно: иначе разработческий стенд и
    первый запуск на новом сервере запирали бы владельца снаружи, а такой
    рубеж, от которого первым делом избавляются, не защищает ничего. Включение
    списка — сознательное действие через настройку.
    """
    networks = allowlist()
    if not networks:
        return True
    ip = client_ip(request)
    if not ip:
        return False
    try:
        address = ipaddress.ip_address(ip)
    except ValueError:
        return False
    for entry in networks:
        try:
            if address in ipaddress.ip_network(entry, strict=False):
                return True
        except ValueError:
            logger.warning("PLATFORM_IP_ALLOWLIST: не разобрана запись %r", entry)
    return False


# --- Роли команды платформы ------------------------------------------------
# Владелец правит всё. Поддержка ведёт отели и входит в них, но не трогает
# команду и тариф. «Только чтение» смотрит и не меняет ничего.

_WRITE_ROLES = {"owner", "support"}


def can_write(user) -> bool:
    return getattr(user, "platform_role", "owner") in _WRITE_ROLES


def can_manage_team(user) -> bool:
    return getattr(user, "platform_role", "owner") == "owner"


def can_manage_tariff(user) -> bool:
    """Тариф — денежный шов, и правит его только владелец."""
    return getattr(user, "platform_role", "owner") == "owner"
