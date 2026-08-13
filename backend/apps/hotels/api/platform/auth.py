"""
Вход платформенного админа и второй фактор.

Отдельно от /staff/auth/login: у платформенного админа hotel = NULL, и обычный
staff-логин (привязанный к тенанту) его не пускает.
"""

from __future__ import annotations

from django.http import HttpRequest

from apps.hotels.api.platform.rights import OWNER, PUBLIC, READ, SELF, WRITE, PlatformRouter, requires
from apps.core.errors import ValidationError
from apps.hotels.schemas.platform import PlatformLoginIn, TotpEnableIn
from apps.hotels.services.platform import console

router = PlatformRouter(tags=["platform"])


@router.post("/auth/login", auth=None, response={200: dict, 401: dict, 403: dict}, summary="Вход платформенного админа")
@requires(PUBLIC)
def platform_login(request: HttpRequest, payload: PlatformLoginIn):
    from django.contrib.auth.hashers import check_password

    from apps.accounts.services.platform_access import client_ip, ip_allowed
    from apps.accounts.services.tokens import encode_refresh_token, encode_staff_token
    from apps.accounts.services.totp import verify as verify_totp

    # Рубеж «откуда» проверяем и на входе: иначе с чужой сети можно было бы
    # перебирать пароли, узнавая по ответу, какой из них верный.
    if not ip_allowed(request):
        return 403, {
            "detail": "Вход в платформу с этого адреса запрещён",
            "code": "ip_not_allowed",
            "ip": client_ip(request),
        }

    user = console.find_platform_admin(payload.email)
    if user is None or not check_password(payload.password, user.password):
        return 401, {"detail": "Неверный логин или пароль", "code": "auth_failed"}

    if user.totp_enabled:
        if not payload.totp_code:
            # Не ошибка, а второй шаг: пароль принят, ждём код.
            return 401, {"detail": "Нужен код подтверждения", "code": "mfa_required"}
        if not verify_totp(user.totp_secret, payload.totp_code):
            return 401, {"detail": "Неверный код подтверждения", "code": "mfa_invalid"}

    console.audit_platform(
        "platform.login",
        actor_id=user.pk,
        ip=request.META.get("REMOTE_ADDR"),
        payload={"mfa": user.totp_enabled},
    )
    return 200, {
        "access": encode_staff_token(user, mfa=user.totp_enabled),
        "refresh": encode_refresh_token(user),
        "user": console.me(user),
    }


@router.get("/auth/me", summary="Текущий платформенный админ")
@requires(READ)
def platform_me(request: HttpRequest):
    return console.me(request.user)


# --- Управление вторым фактором --------------------------------------------


@router.post("/auth/2fa/setup", summary="Завести секрет 2FA (показать QR)")
@requires(SELF)
def totp_setup(request: HttpRequest):
    from apps.accounts.services.totp import generate_secret, provisioning_uri

    user = request.user
    if user.totp_enabled:
        raise ValidationError("2FA уже включена", field="totp")
    # Секрет пересоздаём на каждый заход в мастер: незавершённая прошлая
    # попытка не должна оставлять пригодный секрет, который никто не помнит.
    secret = generate_secret()
    console.save_platform_user(user, totp_secret=secret)
    return {"secret": secret, "otpauth_url": provisioning_uri(secret, account=user.email)}


@router.post("/auth/2fa/enable", summary="Включить 2FA, подтвердив кодом")
@requires(SELF)
def totp_enable(request: HttpRequest, payload: TotpEnableIn):
    from apps.accounts.services.tokens import encode_staff_token
    from apps.accounts.services.totp import verify as verify_totp

    user = request.user
    if not user.totp_secret:
        raise ValidationError("Сначала заведите секрет", field="totp")
    if not verify_totp(user.totp_secret, payload.code):
        raise ValidationError("Код не подошёл", field="code")
    console.save_platform_user(user, totp_enabled=True)
    console.audit_platform("platform.2fa.enabled", actor_id=user.pk, ip=request.META.get("REMOTE_ADDR"))
    # Выдаём новый токен с признаком: текущий выписан до включения 2FA и
    # перестанет действовать — иначе включивший 2FA выкинул бы сам себя.
    return {"ok": True, "access": encode_staff_token(user, mfa=True)}


@router.post("/auth/2fa/disable", summary="Выключить 2FA")
@requires(SELF)
def totp_disable(request: HttpRequest):
    user = request.user
    console.save_platform_user(user, totp_enabled=False, totp_secret="")
    console.audit_platform("platform.2fa.disabled", actor_id=user.pk, ip=request.META.get("REMOTE_ADDR"))
    return {"ok": True}
