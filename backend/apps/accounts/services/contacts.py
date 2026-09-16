"""
КОНТАКТЫ СОТРУДНИКА: телефон и мессенджеры.

ТЕЛЕФОН — КОНТАКТ ЧЕЛОВЕКА, А НЕ ОТЕЛЯ. Видят и меняют его сам сотрудник и
администратор отеля; управляющий сервисом — нет. Управляющему нужен человек
на смене, а не его личный номер: номер попадает в список, который управляющий
видит целиком, и оттуда — куда угодно. Позвонить можно через администратора.

МЕССЕНДЖЕРЫ — ТОЛЬКО ПРИВЯЗКОЙ ЧЕРЕЗ БОТА. Руками ID не вводится: чужой
введённый ID отправлял бы сообщения постороннему, и заметить это некому.
Привязка = одноразовый код (`ContactBindingCode`), который человек отдаёт боту.

БОТОВ ПОКА НЕТ — учётки ждут заказчика. Пока бот не настроен
(`settings.CONTACT_BOTS`), выдача кода отвечает `409 binding_unavailable`, и
экран говорит «пока недоступно», а не рисует рабочую кнопку.
"""

from __future__ import annotations

import hashlib
import re
import secrets
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import ContactBindingCode, User
from apps.core.errors import ConflictError, ValidationError
from apps.core.models import AuditLog

MESSENGERS = tuple(ContactBindingCode.Messenger.values)

# Международный формат: «+», код страны и номер — 8…15 цифр (E.164).
_PHONE_DIGITS = re.compile(r"\d")
PHONE_MIN_DIGITS = 8
PHONE_MAX_DIGITS = 15

_FIELDS = {
    "telegram": ("telegram_chat_id", "telegram_confirmed_at"),
    "max": ("max_user_id", "max_confirmed_at"),
}


# --- Телефон -----------------------------------------------------------------


def normalize_phone(value: str) -> str:
    """
    «8 (916) 123-45-67» и «+7 916 123 45 67» — один номер: «+79161234567».

    Ведущая «8» — российская привычка набора; превращаем её в «+7», только
    когда цифр ровно одиннадцать, иначе это может быть чужой код страны.
    """
    raw = (value or "").strip()
    if not raw:
        return ""
    if re.search(r"[^\d\s()+\-.]", raw) or raw.count("+") > 1 or ("+" in raw and not raw.startswith("+")):
        raise ValidationError(
            "Телефон — цифры, пробелы, скобки и дефисы; «+» только в начале",
            field="phone",
            code="invalid_phone",
        )
    digits = "".join(_PHONE_DIGITS.findall(raw))
    if not raw.startswith("+") and len(digits) == 11 and digits.startswith("8"):
        digits = "7" + digits[1:]
    if not (PHONE_MIN_DIGITS <= len(digits) <= PHONE_MAX_DIGITS):
        raise ValidationError(
            f"В номере от {PHONE_MIN_DIGITS} до {PHONE_MAX_DIGITS} цифр с кодом страны",
            field="phone",
            code="invalid_phone",
        )
    return f"+{digits}"


def can_see_phone(viewer, subject: User) -> bool:
    """Сам человек и администратор отеля. Больше никто."""
    from apps.accounts.services.roles import current_access

    if viewer is not None and str(getattr(viewer, "pk", "")) == str(subject.pk):
        return True
    try:
        return current_access().unrestricted
    except Exception:  # noqa: BLE001 — вне запроса прав нет, и телефона тоже
        return False


# --- Состояние -----------------------------------------------------------------


def bot_for(messenger: str) -> str:
    return (getattr(settings, "CONTACT_BOTS", {}) or {}).get(messenger, "") or ""


def messenger_state(user: User, messenger: str) -> dict:
    id_field, confirmed_field = _FIELDS[messenger]
    confirmed_at = getattr(user, confirmed_field)
    return {
        "linked": bool(getattr(user, id_field)),
        "confirmed_at": confirmed_at.isoformat() if confirmed_at else None,
        "username": user.telegram_username if messenger == "telegram" else "",
        # Можно ли подключить прямо сейчас. Нет бота — нет и подключения.
        "binding_available": bool(bot_for(messenger)),
    }


def contacts_of(user: User) -> dict:
    """Свои контакты — для профиля. Телефон здесь всегда: это свой номер."""
    return {
        "phone": user.phone,
        "messengers": {messenger: messenger_state(user, messenger) for messenger in MESSENGERS},
    }


def public_status(user: User) -> dict:
    """Подключён ли мессенджер — без ID. Для списка сотрудников."""
    return {
        messenger: {
            "linked": messenger_state(user, messenger)["linked"],
            "confirmed_at": messenger_state(user, messenger)["confirmed_at"],
        }
        for messenger in MESSENGERS
    }


def update_own_phone(user: User, phone: str) -> dict:
    normalized = normalize_phone(phone)
    if normalized != user.phone:
        User.objects.filter(pk=user.pk).update(phone=normalized, updated_at=timezone.now())
        user.phone = normalized
        AuditLog.record(
            "staff.contact.phone_changed",
            object_type="user",
            object_id=user.pk,
            payload={"by": "self", "set": bool(normalized)},
        )
    return contacts_of(user)


# --- Коды привязки ---------------------------------------------------------------


def hash_code(code: str) -> str:
    return hashlib.sha256((code or "").strip().encode()).hexdigest()


def _require_messenger(messenger: str) -> None:
    if messenger not in MESSENGERS:
        raise ValidationError("Неизвестный мессенджер", field="messenger", code="unknown_messenger")


def issue_code(user: User, messenger: str) -> dict:
    """
    Выдать код привязки. Действует только последний: новый код отзывает
    прежние неиспользованные, иначе в чужих руках мог бы остаться рабочий.
    """
    _require_messenger(messenger)
    bot = bot_for(messenger)
    if not bot:
        raise ConflictError(
            "Подключение пока недоступно: бот ещё не заведён",
            code="binding_unavailable",
        )

    code = secrets.token_urlsafe(24)
    now = timezone.now()
    expires_at = now + timedelta(minutes=settings.CONTACT_BINDING_CODE_MINUTES)
    with transaction.atomic():
        ContactBindingCode.objects.filter(
            user=user, messenger=messenger, used_at__isnull=True, revoked_at__isnull=True
        ).update(revoked_at=now)
        ContactBindingCode.objects.create(
            hotel_id=user.hotel_id,
            user=user,
            messenger=messenger,
            code_hash=hash_code(code),
            expires_at=expires_at,
        )
    link = f"https://t.me/{bot}?start={code}" if messenger == "telegram" else ""
    return {"code": code, "link": link, "expires_at": expires_at.isoformat()}


class BindingRejected(Exception):
    """Код не обменян. `reason` — для ответа бота человеку."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def redeem_code(messenger: str, code: str, *, external_id: str, username: str = "") -> User:
    """
    Обменять код на привязку. Зовёт БОТ — платформенный процесс без отеля,
    поэтому всё идёт платформенным подключением.

    Атомарно: строка кода блокируется, проверяется и гасится в одной
    транзакции — второй обмен того же кода (повтор сообщения боту, две копии
    бота) получит «уже использован», а не вторую привязку.
    """
    _require_messenger(messenger)
    external_id = str(external_id or "").strip()
    if not external_id:
        raise BindingRejected("no_account")

    from apps.core.context import platform_scope

    id_field, confirmed_field = _FIELDS[messenger]
    with platform_scope(), transaction.atomic(using="platform"):
        binding = (
            ContactBindingCode.all_objects.using("platform")
            .select_for_update()
            .filter(code_hash=hash_code(code), messenger=messenger)
            .first()
        )
        if binding is None:
            raise BindingRejected("unknown")
        if binding.used_at is not None:
            raise BindingRejected("used")
        if binding.revoked_at is not None:
            raise BindingRejected("revoked")
        if binding.expires_at <= timezone.now():
            raise BindingRejected("expired")

        users = User.all_objects.using("platform")
        user = users.filter(pk=binding.user_id, is_active=True, deleted_at__isnull=True).first()
        if user is None:
            raise BindingRejected("inactive")
        taken = (
            users.filter(hotel_id=user.hotel_id, deleted_at__isnull=True, **{id_field: external_id})
            .exclude(pk=user.pk)
            .exists()
        )
        if taken:
            # Один аккаунт — один сотрудник: иначе сообщения одного уходили бы
            # другому, и никто бы этого не заметил.
            raise BindingRejected("taken")

        now = timezone.now()
        binding.used_at = now
        binding.external_id = external_id[:64]
        binding.save(using="platform", update_fields=["used_at", "external_id", "updated_at"])
        changes = {id_field: external_id[:64], confirmed_field: now, "updated_at": now}
        if messenger == "telegram":
            changes["telegram_username"] = (username or "")[:64]
        users.filter(pk=user.pk).update(**changes)
        AuditLog.objects.using("platform").create(
            hotel_id=user.hotel_id,
            actor_type=AuditLog.ActorType.SYSTEM,
            action="staff.contact.linked",
            object_type="user",
            object_id=user.pk,
            payload={"messenger": messenger},
        )
    user.refresh_from_db(using="platform")
    return user


def unlink(user: User, messenger: str) -> dict:
    _require_messenger(messenger)
    id_field, confirmed_field = _FIELDS[messenger]
    if getattr(user, id_field):
        changes = {id_field: "", confirmed_field: None, "updated_at": timezone.now()}
        if messenger == "telegram":
            changes["telegram_username"] = ""
        User.objects.filter(pk=user.pk).update(**changes)
        for field, value in changes.items():
            setattr(user, field, value)
        AuditLog.record(
            "staff.contact.unlinked",
            object_type="user",
            object_id=user.pk,
            payload={"messenger": messenger},
        )
    return contacts_of(user)
