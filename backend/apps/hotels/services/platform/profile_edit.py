"""
Правка профиля отеля из Control (партия 62-C).

* Название и город — по каждому языку отеля: пришедшие языки кладутся поверх
  существующих переводов, пустая строка убирает перевод (кроме основного
  языка у названия). Переводы, которых в правке нет, не трогаются.
* Сохраняются только изменённые поля, журнал пишет «было → стало».
* ОПАСНЫЕ ПРАВКИ — часовой пояс, валюта и её знаки, поддомен — без явного
  подтверждения не проходят: 409 `needs_confirmation` с последствиями. Экран
  показывает их и повторяет запрос с `confirm`.
* Поддомен и свой домен — только владелец.
* Смена поддомена оставляет БЕССРОЧНОЕ перенаправление со старого: строка
  `HotelSubdomainAlias`, снимается только руками.
"""

from __future__ import annotations

import re
import socket
from typing import Any

from django.conf import settings
from django.db import transaction

from apps.core.errors import ConflictError, PermissionDenied, ValidationError
from apps.hotels.models import Hotel, HotelSubdomainAlias

DANGEROUS = ("timezone", "currency", "currency_minor_units", "subdomain")
OWNER_ONLY = ("subdomain", "custom_domain")

# Последствия опасных правок: код строки — для перевода на экране, текст — для
# API и журнала. Порядок — от самого заметного гостю.
CONSEQUENCES: dict[str, list[tuple[str, str]]] = {
    "timezone": [
        ("hours_shift", "Часы работы заведений и расписания сдвинутся: «с 08:00» станет 08:00 по новому поясу."),
        ("reports_day", "Отчёты «за сегодня» начнут считать сутки по новому поясу."),
        ("logs_same", "Время в журналах не изменится — оно хранится независимо от пояса."),
    ],
    "currency": [
        ("no_recalc", "Цены хранятся числами — пересчёта не будет: 1 500 ₽ станут 1 500 в новой валюте."),
        ("open_orders", "Открытые заказы и корзины гостей останутся в прежней валюте."),
        ("minor_separate", "Знаков после запятой — отдельная настройка, она сама не меняется."),
    ],
    "currency_minor_units": [
        ("prices_scale", "Цены хранятся в минимальных единицах: при смене знаков 1 500,00 может стать 150 000 или 15,00."),
        ("check_menu", "После смены проверьте цены в меню отеля."),
    ],
    "subdomain": [
        ("old_redirects", "Старый адрес и QR в номерах будут перенаправлять на новый, пока перенаправление не снимут вручную — перепечатывать QR не обязательно."),
        ("relogin", "Сотрудники и гости войдут заново уже по новому адресу."),
        ("tls", "Новый адрес начнёт открываться по HTTPS после перевыпуска сертификата стенда."),
    ],
}

DOMAIN_RE = re.compile(r"^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")


def _translations(value, language: str) -> dict:
    if isinstance(value, dict):
        return {k: v for k, v in value.items() if isinstance(v, str)}
    return {language: value} if value else {}


def _merge(current: dict, incoming: dict, *, keep: str | None = None) -> dict:
    """Языки из правки — поверх прежних; пустое значение убирает перевод."""
    out = dict(current)
    for lang, text in incoming.items():
        text = (text or "").strip() if isinstance(text, str) else ""
        if text:
            out[str(lang)] = text
        elif lang != keep:
            out.pop(str(lang), None)
    return out


def _clean_domain(value: str) -> str:
    host = (value or "").strip().lower()
    host = re.sub(r"^[a-z]+://", "", host).split("/")[0].split(":")[0].rstrip(".")
    if not host:
        return ""
    if not DOMAIN_RE.match(host):
        raise ValidationError("Домен — вида menu.hotel.ru, без http:// и пути", field="custom_domain", code="domain_format")
    for base in settings.GUEST_APP_BASE_DOMAINS:
        if host == base or host.endswith(f".{base}"):
            raise ValidationError("Это адрес платформы, а не свой домен отеля", field="custom_domain", code="domain_platform")
    return host


def apply(hotel: Hotel, data: dict[str, Any], *, user, ip: str | None = None) -> dict[str, dict]:
    """
    Применить правку. Возвращает изменения «поле → {from, to}» (пусто — ничего
    не поменялось). Опасное без подтверждения — 409 до всякой записи.
    """
    from apps.accounts.services.platform_access import is_owner
    from apps.hotels.services.hotel_fields import alias_owner, clean_currency, clean_subdomain, clean_timezone
    from apps.hotels.services.platform import activation, console

    confirm = set(data.get("confirm") or [])
    lang = hotel.default_language
    wanted: dict[str, Any] = {}

    if data.get("name") is not None:
        incoming = data["name"] if isinstance(data["name"], dict) else {lang: str(data["name"])}
        merged = _merge(_translations(hotel.name, lang), incoming, keep=lang)
        if (lang in incoming and not str(incoming[lang] or "").strip()) or not merged.get(lang, "").strip():
            raise ValidationError("Название на основном языке не может быть пустым", field="name", code="required")
        wanted["name"] = merged
    if data.get("city") is not None:
        wanted["city"] = _merge(_translations(hotel.city, lang), data["city"] or {})
    if data.get("timezone") is not None:
        wanted["timezone"] = clean_timezone(data["timezone"])
    if data.get("currency") is not None:
        wanted["currency"] = clean_currency(data["currency"])
    if data.get("currency_minor_units") is not None:
        units = int(data["currency_minor_units"])
        if not 0 <= units <= 4:
            raise ValidationError("Знаков после запятой — от 0 до 4", field="currency_minor_units", code="bad_minor_units")
        wanted["currency_minor_units"] = units
    if data.get("subdomain") is not None:
        wanted["subdomain"] = clean_subdomain(data["subdomain"])
    if "custom_domain" in data and data["custom_domain"] is not None:
        wanted["custom_domain"] = _clean_domain(data["custom_domain"])

    changing = {field: value for field, value in wanted.items() if getattr(hotel, field) != value}

    # Только владелец — до разговора о последствиях: поддержке незачем их читать.
    owner_fields = [field for field in OWNER_ONLY if field in changing]
    if owner_fields and not is_owner(user):
        raise PermissionDenied("Поддомен и свой домен меняет только владелец платформы", code="owner_only", fields=owner_fields)

    if "subdomain" in changing:
        new = changing["subdomain"]
        if Hotel.all_objects.filter(subdomain=new).exclude(pk=hotel.pk).exists():
            raise ConflictError(f"Поддомен «{new}» занят другим отелем", code="hotel_exists", field="subdomain")
        owner = alias_owner(new)
        if owner is not None and owner.pk != hotel.pk:
            raise ConflictError(
                f"«{new}» — прежний адрес другого отеля, с него идёт перенаправление", code="subdomain_alias", field="subdomain"
            )
    if changing.get("custom_domain"):
        if Hotel.objects.filter(custom_domain=changing["custom_domain"]).exclude(pk=hotel.pk).exists():
            raise ConflictError("Этот домен уже у другого отеля", code="domain_taken", field="custom_domain")

    missing = [field for field in DANGEROUS if field in changing and field not in confirm]
    if missing:
        raise ConflictError(
            "Правка меняет то, что заметят гости и сотрудники — подтвердите её",
            code="needs_confirmation",
            fields=missing,
            consequences={field: [{"code": c, "text": t} for c, t in CONSEQUENCES[field]] for field in missing},
        )

    changes: dict[str, dict] = {}
    with transaction.atomic():
        if changing:
            old_subdomain = hotel.subdomain
            for field, value in changing.items():
                changes[field] = {"from": getattr(hotel, field), "to": value}
                setattr(hotel, field, value)
            hotel.save(update_fields=[*changing, "updated_at"])
            if "subdomain" in changing:
                # Вернулись к прежнему имени — его перенаправление больше не нужно.
                HotelSubdomainAlias.all_objects.filter(old=hotel.subdomain).hard_delete()
                HotelSubdomainAlias.objects.get_or_create(old=old_subdomain, defaults={"hotel": hotel, "created_by": getattr(user, "pk", None)})

        if data.get("languages") is not None:
            language_change = console.replace_languages(hotel, data["languages"])
            if language_change:
                changes["languages"] = language_change

        if changes:
            console.audit_hotel(
                hotel,
                "platform.hotel.updated",
                actor_id=getattr(user, "pk", None),
                ip=ip,
                payload={"fields": sorted(changes), "changes": changes},
            )

        if data.get("is_active") is True and not hotel.is_active:
            activation.enable(hotel, actor_id=getattr(user, "pk", None), ip=ip)
        elif data.get("is_active") is False and hotel.is_active:
            activation.disable(
                hotel, reason=data.get("reason") or "", enable_on=data.get("enable_on"), actor_id=getattr(user, "pk", None), ip=ip
            )
    return changes


def remove_alias(hotel: Hotel, old: str, *, user, ip: str | None = None) -> None:
    """Снять перенаправление со старого поддомена — только вручную, только владелец."""
    from apps.accounts.services.platform_access import is_owner
    from apps.core.errors import NotFoundError
    from apps.hotels.services.platform import console

    if not is_owner(user):
        raise PermissionDenied("Перенаправление снимает только владелец платформы", code="owner_only")
    rows = HotelSubdomainAlias.all_objects.filter(hotel=hotel, old=old)
    if not rows.exists():
        raise NotFoundError("Такого перенаправления у отеля нет")
    # Жёстко: мягко удалённая строка держала бы имя уникальным индексом.
    rows.hard_delete()
    console.audit_hotel(
        hotel,
        "platform.hotel.updated",
        actor_id=getattr(user, "pk", None),
        ip=ip,
        payload={"fields": ["subdomain_alias"], "changes": {"subdomain_alias": {"from": old, "to": None}}},
    )


def aliases(hotel: Hotel) -> list[dict]:
    return [
        {"old": alias.old, "created_at": alias.created_at.isoformat()}
        for alias in HotelSubdomainAlias.objects.filter(hotel=hotel).order_by("-created_at")
    ]


def _addresses(host: str) -> list[str]:
    try:
        return sorted({info[4][0] for info in socket.getaddrinfo(host, None, socket.AF_INET)})
    except (socket.gaierror, UnicodeError):
        return []


def check_domain(value: str) -> dict:
    """
    Указывает ли домен на стенд: его адреса против адресов базы платформы.
    Сертификат на него выпускает `infra/nginx/enable-tls.sh` (имена — из
    `manage.py tls_names`, свой домен там уже есть) — запускается на стенде
    только по слову.
    """
    domain = _clean_domain(value)
    if not domain:
        raise ValidationError("Укажите домен", field="custom_domain", code="required")
    expected = sorted({ip for base in settings.GUEST_APP_BASE_DOMAINS for ip in _addresses(base)})
    resolved = _addresses(domain)
    return {
        "domain": domain,
        "resolved": resolved,
        "expected": expected,
        "points_here": bool(resolved) and bool(set(resolved) & set(expected)),
    }
