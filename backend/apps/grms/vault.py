"""
Секреты сервера управления отеля — зашифрованно (партия 63-3).

Логин и пароль или токен сервера вводятся в Control, хранятся в базе
ЗАШИФРОВАННЫМИ ключом из окружения (`CONTROL_SERVER_SECRET_KEY`, Fernet) и
наружу отдаются в одном месте — коннектору, в настройках сервера. На экран, в
ответ API, в журнал и в логи секрет не попадает.

Без ключа процесс не стартует (`GrmsConfig.ready`): тихо работающий бэкенд,
который при первой же правке сервера падает или хранит секрет открытым, хуже
понятной ошибки запуска.
"""

from __future__ import annotations

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

MISSING = (
    "Не задан CONTROL_SERVER_SECRET_KEY — ключ шифрования секретов сервера управления. "
    "Сгенерируйте: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\" "
    "и впишите в окружение (.env / .env.prod)."
)


def _fernet():
    from cryptography.fernet import Fernet

    key = (getattr(settings, "CONTROL_SERVER_SECRET_KEY", "") or "").strip()
    if not key:
        raise ImproperlyConfigured(MISSING)
    try:
        return Fernet(key.encode())
    except (ValueError, TypeError) as exc:
        raise ImproperlyConfigured(f"CONTROL_SERVER_SECRET_KEY негодный ({exc}): нужен ключ Fernet, 32 байта в base64") from None


def check_key() -> None:
    """Проверка при запуске: ключ есть и годный."""
    _fernet()


def seal(plain: str) -> str:
    """Секрет → шифр для базы. Пустой секрет — пустая строка."""
    if not plain:
        return ""
    return _fernet().encrypt(plain.encode("utf-8")).decode("ascii")


def unseal(sealed: str) -> str:
    """Шифр из базы → секрет. Не читается (сменили ключ) — пусто: ввести заново."""
    if not sealed:
        return ""
    from cryptography.fernet import InvalidToken

    try:
        return _fernet().decrypt(sealed.encode("ascii")).decode("utf-8")
    except InvalidToken:
        return ""
