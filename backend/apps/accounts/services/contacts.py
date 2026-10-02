"""
КОНТАКТЫ СОТРУДНИКА: телефон и мессенджеры.

ТЕЛЕФОН — КОНТАКТ ЧЕЛОВЕКА, А НЕ ОТЕЛЯ. Видят и меняют его сам сотрудник и
администратор отеля; управляющий сервисом — нет. Управляющему нужен человек
на смене, а не его личный номер: номер попадает в список, который управляющий
видит целиком, и оттуда — куда угодно. Позвонить можно через администратора.

МЕССЕНДЖЕРЫ — ТОЛЬКО ПРИВЯЗКОЙ ЧЕРЕЗ БОТА. Руками ID не вводится: чужой
введённый ID отправлял бы сообщения постороннему, и заметить это некому.
Привязка = одноразовый код (`ContactBindingCode`), который человек отдаёт боту.

БОТ — ОДИН НА ПЛАТФОРМУ (партия 28), служба `bot`. Его имя берётся из пульса
службы (`getMe`), а не из настроек. Пока бот не на связи — нет токена, токен
не принят, служба стоит — выдача кода отвечает `409 binding_unavailable`, и
экран говорит «бот не подключён», а не рисует рабочую кнопку. Отель, который
выключил Telegram, отвечает `409 telegram_disabled`. Max — только интерфейс:
бота у него нет, и подключение недоступно всегда.

ПРИВЯЗКА ЗАВОДИТ ЛИЧНЫЙ КАНАЛ УВЕДОМЛЕНИЙ, отвязка его выключает
(`apps/notifications/services/personal.py`).
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
    """Имя бота, если он на связи. Max — только интерфейс, бота нет."""
    if messenger != "telegram":
        return ""
    from apps.notifications.services import personal

    return personal.bot_username(messenger)


def unavailable_reason(user: User, messenger: str) -> str:
    """Почему подключить нельзя: `no_bot` / `hotel_off`, пусто — можно."""
    if not bot_for(messenger):
        return "no_bot"
    from apps.notifications.services import personal

    if user.hotel_id and not personal.hotel_allows(user.hotel_id):
        return "hotel_off"
    return ""


def messenger_state(user: User, messenger: str) -> dict:
    id_field, confirmed_field = _FIELDS[messenger]
    confirmed_at = getattr(user, confirmed_field)
    reason = unavailable_reason(user, messenger)
    state = {
        "linked": bool(getattr(user, id_field)),
        "confirmed_at": confirmed_at.isoformat() if confirmed_at else None,
        "username": user.telegram_username if messenger == "telegram" else "",
        # Можно ли подключить прямо сейчас. Нет бота — нет и подключения.
        "binding_available": not reason,
        "unavailable_reason": reason,
    }
    if messenger == "telegram":
        from apps.notifications.services import personal

        state["blocked"] = personal.delivery_status(user)["blocked"] if state["linked"] else False
    return state


def contacts_of(user: User) -> dict:
    """Свои контакты — для профиля. Телефон здесь всегда: это свой номер."""
    return {
        "phone": user.phone,
        "messengers": {messenger: messenger_state(user, messenger) for messenger in MESSENGERS},
    }


def public_status(user: User, *, with_delivery: bool = False) -> dict:
    """
    Подключён ли мессенджер — без ID. Для списка сотрудников.

    `with_delivery` — для администратора отеля: последняя доставка, последняя
    ошибка и «бот заблокирован». Управляющему хватает «подключён / нет».
    """
    status = {}
    for messenger in MESSENGERS:
        id_field, confirmed_field = _FIELDS[messenger]
        confirmed_at = getattr(user, confirmed_field)
        status[messenger] = {
            "linked": bool(getattr(user, id_field)),
            "confirmed_at": confirmed_at.isoformat() if confirmed_at else None,
        }
    if with_delivery:
        from apps.notifications.services import personal

        status["telegram"].update(personal.delivery_status(user))
    return status


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
            "Подключение недоступно: бот не подключён",
            code="binding_unavailable",
        )
    if unavailable_reason(user, messenger) == "hotel_off":
        raise ConflictError(
            "Отель выключил уведомления в Telegram",
            code="telegram_disabled",
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
        from apps.notifications.services import personal

        if messenger == "telegram" and not personal.hotel_allows(user.hotel_id):
            raise BindingRejected("hotel_off")
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
        if messenger == "telegram":
            personal.ensure_channel(user, using="platform")
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
        if messenger == "telegram":
            from apps.notifications.services import personal

            personal.disable_channel(user)
        AuditLog.record(
            "staff.contact.unlinked",
            object_type="user",
            object_id=user.pk,
            payload={"messenger": messenger},
        )
    return contacts_of(user)


def unlink_chat(messenger: str, external_id: str) -> list[User]:
    """
    Отвязка командой боту: все учётки этого аккаунта, во всех отелях — один
    человек в двух отелях пишет боту «/stop» один раз. Зовёт бот, отеля у
    него нет, поэтому платформенным подключением.
    """
    _require_messenger(messenger)
    external_id = str(external_id or "").strip()
    if not external_id:
        return []
    from apps.core.context import platform_scope
    from apps.notifications.services import personal

    id_field, confirmed_field = _FIELDS[messenger]
    with platform_scope(), transaction.atomic(using="platform"):
        users = User.all_objects.using("platform")
        bound = list(users.filter(deleted_at__isnull=True, **{id_field: external_id}).select_related("hotel"))
        for user in bound:
            changes = {id_field: "", confirmed_field: None, "updated_at": timezone.now()}
            if messenger == "telegram":
                changes["telegram_username"] = ""
            users.filter(pk=user.pk).update(**changes)
            if messenger == "telegram":
                personal.disable_channel(user, using="platform")
            AuditLog.objects.using("platform").create(
                hotel_id=user.hotel_id,
                actor_type=AuditLog.ActorType.STAFF,
                actor_id=user.pk,
                action="staff.contact.unlinked",
                object_type="user",
                object_id=user.pk,
                payload={"messenger": messenger, "by": "bot"},
            )
    return bound


def bound_users(messenger: str, external_id: str) -> list[User]:
    """Кто привязан к этому аккаунту — во всех отелях. Для бота."""
    external_id = str(external_id or "").strip()
    if not external_id:
        return []
    from apps.core.context import platform_scope

    id_field, _ = _FIELDS[messenger]
    with platform_scope():
        return list(
            User.all_objects.using("platform")
            .filter(deleted_at__isnull=True, is_active=True, **{id_field: external_id})
            .select_related("hotel")
        )



# --- Приглашение письмом -----------------------------------------------------------

INVITE_PATH = "/admin/profile?connect=telegram"

_INVITE_SUBJECT = {
    "ru": "Подключите уведомления в Telegram",
    "en": "Connect Telegram notifications",
}
_INVITE_BODY = {
    "ru": (
        "Здравствуйте!\n\n"
        "Администратор отеля «{hotel}» приглашает вас получать рабочие уведомления в Telegram.\n\n"
        "Откройте ссылку, войдите своим логином и нажмите «Открыть бота»:\n{url}\n\n"
        "Пароль в боте вводить не нужно и некуда: бот узнаёт вас по одноразовому коду из профиля.\n"
    ),
    "en": (
        "Hello!\n\n"
        "The administrator of {hotel} invites you to receive work notifications in Telegram.\n\n"
        "Open the link, sign in and press “Open the bot”:\n{url}\n\n"
        "The bot never asks for a password: it recognises you by a one-time code from your profile.\n"
    ),
}


def invite(user: User) -> dict:
    """
    Приглашение письмом от администратора отеля.

    В письме — ССЫЛКА НА ПРОФИЛЬ, А НЕ КОД. Код живёт десять минут (решение
    волны 6) — письмо читают через час. И письмо, ушедшее не туда, ничего не
    привязывает: код выдаётся только тому, кто вошёл своим логином.
    """
    from apps.core.fields import translate
    from apps.core.models import AuditLog
    from apps.hotels.services.admin_credentials import MailNotConfigured, MailNotSent, mail_is_deliverable

    if user.telegram_chat_id:
        raise ConflictError("Telegram у сотрудника уже подключён", code="already_linked")
    if not bot_for("telegram"):
        raise ConflictError("Подключение недоступно: бот не подключён", code="binding_unavailable")
    if unavailable_reason(user, "telegram") == "hotel_off":
        raise ConflictError("Отель выключил уведомления в Telegram", code="telegram_disabled")
    if not mail_is_deliverable():
        raise MailNotConfigured("Почта не настроена: приглашение отправить нечем", code="mail_not_configured")

    from django.core.mail import EmailMessage

    hotel = user.hotel
    language = "en" if (user.language or "").startswith("en") else "ru"
    url = hotel.public_guest_url(INVITE_PATH)
    message = EmailMessage(
        subject=_INVITE_SUBJECT[language],
        body=_INVITE_BODY[language].format(
            hotel=translate(hotel.name, language) or hotel.subdomain, url=url
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[user.email],
    )
    try:
        sent = message.send(fail_silently=False)
    except Exception as exc:  # noqa: BLE001 — сеть, SMTP: исход один
        raise MailNotSent("Письмо-приглашение не ушло. Повторите позже.", code="mail_not_sent") from exc
    if not sent:
        raise MailNotSent("Почтовый сервер не принял письмо", code="mail_not_sent")
    AuditLog.record(
        "staff.contact.invited",
        object_type="user",
        object_id=user.pk,
        payload={"messenger": "telegram"},
    )
    return {"delivered_to": user.email, "sent_at": timezone.now().isoformat()}
