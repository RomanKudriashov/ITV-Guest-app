"""
TOTP (RFC 6238) для усиленного входа в корневую админку.

Реализовано на стандартной библиотеке, а не пакетом: алгоритм — это HMAC и
динамическое усечение, тридцать строк с фиксированным RFC-описанием, и держать
ради них зависимость (а с ней пересборку образа и ещё один источник обновлений
безопасности) невыгодно. Тестируется по контрольным векторам RFC.

Секрет хранится у пользователя в base32 — в этом виде его понимают все
приложения-аутентификаторы, и его же несёт otpauth-ссылка для QR.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

# Шаг окна и допуск. Допуск в один шаг в обе стороны — обязательный компромисс:
# часы телефона и сервера расходятся, и без него честный код отвергался бы у
# части людей. Больше одного шага — уже заметное расширение окна перебора.
STEP_SECONDS = 30
WINDOW_STEPS = 1
DIGITS = 6


def generate_secret() -> str:
    """Новый секрет: 20 байт (160 бит, как советует RFC) в base32 без padding."""
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def _code_at(secret: str, counter: int) -> str:
    # base32 требует padding кратно 8 — восстанавливаем перед декодированием.
    padded = secret.upper() + "=" * (-len(secret) % 8)
    key = base64.b32decode(padded, casefold=True)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    truncated = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(truncated % (10**DIGITS)).zfill(DIGITS)


def code_at(secret: str, moment: float | None = None) -> str:
    """Текущий код. Нужен тестам и одноразовой проверке при включении 2FA."""
    now = time.time() if moment is None else moment
    return _code_at(secret, int(now // STEP_SECONDS))


def verify(secret: str, code: str, moment: float | None = None) -> bool:
    """Совпадает ли код с одним из шагов окна. Сравнение — постоянного времени."""
    if not secret or not code:
        return False
    code = code.strip().replace(" ", "")
    if not code.isdigit() or len(code) != DIGITS:
        return False
    now = time.time() if moment is None else moment
    counter = int(now // STEP_SECONDS)
    return any(
        hmac.compare_digest(_code_at(secret, counter + shift), code)
        for shift in range(-WINDOW_STEPS, WINDOW_STEPS + 1)
    )


def provisioning_uri(secret: str, *, account: str, issuer: str = "ITV Platform") -> str:
    """otpauth-ссылка для QR в приложении-аутентификаторе."""
    label = quote(f"{issuer}:{account}", safe="")
    return (
        f"otpauth://totp/{label}?secret={secret}"
        f"&issuer={quote(issuer, safe='')}&algorithm=SHA1&digits={DIGITS}&period={STEP_SECONDS}"
    )
