"""
ПОЛЯ ОТЕЛЯ, КОТОРЫЕ ВЫБИРАЮТ ИЗ СПИСКА, — И ИХ ПРОВЕРКА НА СЕРВЕРЕ (партия 54).

В NaviRoom Control часовой пояс, валюту, языки и поддомен вводили руками, а
сервер принимал почти всё: опечатка в поясе молча становилась UTC, «rub»
сохранялась как есть, «RUBL» падала пятисоткой из базы, отель с поддоменом
`admin` создавался и был недоступен. Форма теперь даёт выбор из списка, но
список на экране — подсказка, а не охрана: охрана — здесь, и списки для формы
берутся отсюда же (`reference()`), чтобы экран и проверка не разошлись.
"""

from __future__ import annotations

import re
import zoneinfo
from functools import lru_cache

from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email

from apps.core.errors import ValidationError

# Поддомен — метка DNS: латиница в нижнем регистре, цифры, дефис не по краям.
# Длина: от 3 (двухбуквенные коды читаются как язык или страна) до 30 (адрес
# отеля печатают на QR и в письмах — длиннее неудобно и человеку, и сканеру).
SUBDOMAIN_MIN = 3
SUBDOMAIN_MAX = 30
SUBDOMAIN_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$")

# ISO 4217, действующие коды → число знаков после запятой. Список — в коде, а
# не пакетом: он меняется раз в несколько лет, а размерность нужна здесь же,
# чтобы предложить её вместе с валютой.
CURRENCIES: dict[str, int] = {
    "AED": 2, "AFN": 2, "ALL": 2, "AMD": 2, "AOA": 2, "ARS": 2, "AUD": 2, "AWG": 2,
    "AZN": 2, "BAM": 2, "BBD": 2, "BDT": 2, "BGN": 2, "BHD": 3, "BIF": 0, "BMD": 2,
    "BND": 2, "BOB": 2, "BRL": 2, "BSD": 2, "BTN": 2, "BWP": 2, "BYN": 2, "BZD": 2,
    "CAD": 2, "CDF": 2, "CHF": 2, "CLP": 0, "CNY": 2, "COP": 2, "CRC": 2, "CUP": 2,
    "CVE": 2, "CZK": 2, "DJF": 0, "DKK": 2, "DOP": 2, "DZD": 2, "EGP": 2, "ERN": 2,
    "ETB": 2, "EUR": 2, "FJD": 2, "FKP": 2, "GBP": 2, "GEL": 2, "GHS": 2, "GIP": 2,
    "GMD": 2, "GNF": 0, "GTQ": 2, "GYD": 2, "HKD": 2, "HNL": 2, "HTG": 2, "HUF": 2,
    "IDR": 2, "ILS": 2, "INR": 2, "IQD": 3, "IRR": 2, "ISK": 0, "JMD": 2, "JOD": 3,
    "JPY": 0, "KES": 2, "KGS": 2, "KHR": 2, "KMF": 0, "KPW": 2, "KRW": 0, "KWD": 3,
    "KYD": 2, "KZT": 2, "LAK": 2, "LBP": 2, "LKR": 2, "LRD": 2, "LSL": 2, "LYD": 3,
    "MAD": 2, "MDL": 2, "MGA": 2, "MKD": 2, "MMK": 2, "MNT": 2, "MOP": 2, "MRU": 2,
    "MUR": 2, "MVR": 2, "MWK": 2, "MXN": 2, "MYR": 2, "MZN": 2, "NAD": 2, "NGN": 2,
    "NIO": 2, "NOK": 2, "NPR": 2, "NZD": 2, "OMR": 3, "PAB": 2, "PEN": 2, "PGK": 2,
    "PHP": 2, "PKR": 2, "PLN": 2, "PYG": 0, "QAR": 2, "RON": 2, "RSD": 2, "RUB": 2,
    "RWF": 0, "SAR": 2, "SBD": 2, "SCR": 2, "SDG": 2, "SEK": 2, "SGD": 2, "SHP": 2,
    "SLE": 2, "SOS": 2, "SRD": 2, "SSP": 2, "STN": 2, "SVC": 2, "SYP": 2, "SZL": 2,
    "THB": 2, "TJS": 2, "TMT": 2, "TND": 3, "TOP": 2, "TRY": 2, "TTD": 2, "TWD": 2,
    "TZS": 2, "UAH": 2, "UGX": 0, "USD": 2, "UYU": 2, "UZS": 2, "VES": 2, "VND": 0,
    "VUV": 0, "WST": 2, "XAF": 0, "XCD": 2, "XCG": 2, "XOF": 0, "XPF": 0, "YER": 2,
    "ZAR": 2, "ZMW": 2, "ZWG": 2,
}


@lru_cache(maxsize=1)
def timezones() -> tuple[str, ...]:
    """Имена зон IANA — те же, что предлагает CMS отеля (`hotel_settings`)."""
    return tuple(sorted(zoneinfo.available_timezones()))


def reserved_subdomains() -> list[str]:
    """
    Занятые платформой имена. Список ОДИН — `GUEST_APP_RESERVED_SUBDOMAINS` в
    настройках: по нему же разбор хоста не пускает такие имена к отелю, и
    отель, заведённый на них, был бы недоступен.
    """
    return sorted(settings.GUEST_APP_RESERVED_SUBDOMAINS)


def subdomain_problem(value: str) -> str | None:
    """Код отказа для поддомена или None. Занятость отелем — отдельно, в базе."""
    if not SUBDOMAIN_MIN <= len(value) <= SUBDOMAIN_MAX or not SUBDOMAIN_RE.match(value):
        return "subdomain_format"
    if value in settings.GUEST_APP_RESERVED_SUBDOMAINS:
        return "subdomain_reserved"
    return None


def clean_subdomain(value: str) -> str:
    value = (value or "").strip().lower()
    if not value:
        raise ValidationError("Нужен поддомен", field="subdomain")
    problem = subdomain_problem(value)
    if problem == "subdomain_format":
        raise ValidationError(
            f"Поддомен — от {SUBDOMAIN_MIN} до {SUBDOMAIN_MAX} знаков: латиница, цифры, "
            "дефис не по краям",
            field="subdomain",
            code=problem,
        )
    if problem == "subdomain_reserved":
        raise ValidationError(f"Имя «{value}» занято платформой", field="subdomain", code=problem)
    return value


def clean_timezone(value: str) -> str:
    name = (value or "").strip()
    if name not in timezones():
        raise ValidationError(
            f"Неизвестный часовой пояс: {name or '—'}. Ожидается имя зоны IANA, например Europe/Moscow",
            field="timezone",
            code="timezone_unknown",
        )
    return name


def clean_currency(value: str) -> str:
    code = (value or "").strip().upper()
    if code not in CURRENCIES:
        raise ValidationError(
            f"Неизвестная валюта: {code or '—'}. Ожидается код ISO 4217, например RUB",
            field="currency",
            code="currency_unknown",
        )
    return code


def clean_email(value: str, *, field: str = "admin_email") -> str:
    email = (value or "").strip().lower()
    if not email:
        raise ValidationError("Нужен email администратора", field=field)
    try:
        validate_email(email)
    except DjangoValidationError:
        raise ValidationError(f"Неверный email: {email}", field=field, code="email_invalid") from None
    return email


def reference() -> dict:
    """Списки для формы отеля в NaviRoom Control — из тех же источников, что проверка."""
    return {
        "timezones": list(timezones()),
        "currencies": [{"code": code, "minor_units": minor} for code, minor in sorted(CURRENCIES.items())],
        "languages": list(settings.SUPPORTED_LANGUAGES),
        "subdomain": {
            "min": SUBDOMAIN_MIN,
            "max": SUBDOMAIN_MAX,
            "pattern": SUBDOMAIN_RE.pattern,
            "reserved": reserved_subdomains(),
        },
    }


def subdomain_status(value: str) -> dict:
    """
    Ответ проверки «свободен ли» — форма спрашивает на ходу, пока человек
    печатает. Тот же порядок, что при создании: формат, запрет, занятость.
    """
    from apps.hotels.models import Hotel

    value = (value or "").strip().lower()
    code = subdomain_problem(value) if value else "subdomain_format"
    if code is None and Hotel.objects.filter(subdomain=value).exists():
        code = "hotel_exists"
    return {"value": value, "ok": code is None, "code": code}


def hotel_cities() -> list[str]:
    """
    Города отелей флота — для правила группы. Правило сверяет город подстрокой
    по всем переводам, поэтому в список идут все переводы: выбрать можно на
    любом языке, а опечатка, тихо дававшая пустую группу, невозможна.
    """
    from apps.hotels.models import Hotel

    seen: set[str] = set()
    for city in Hotel.objects.exclude(city={}).values_list("city", flat=True):
        if isinstance(city, dict):
            seen.update(text.strip() for text in city.values() if isinstance(text, str) and text.strip())
    return sorted(seen, key=str.casefold)
