"""
Вход платформенного админа и второй фактор.

Отдельно от /staff/auth/login: у платформенного админа hotel = NULL, и обычный
staff-логин (привязанный к тенанту) его не пускает.
"""

from __future__ import annotations

from django.http import HttpRequest

from apps.hotels.api.platform.rights import OWNER, PUBLIC, READ, SELF, WRITE, PlatformRouter, requires
from apps.core.errors import ValidationError
from apps.hotels.schemas.platform import PlatformLoginIn, PlatformRefreshIn, TotpEnableIn
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
    from apps.accounts.services import sessions as session_svc

    session = session_svc.open_session(user, scope="platform", request=request)
    return 200, {
        "access": encode_staff_token(user, mfa=user.totp_enabled, session_id=session.pk),
        "refresh": encode_refresh_token(user, session_id=session.pk),
        "user": console.me(user),
    }


@router.post(
    "/auth/refresh",
    auth=None,
    response={200: dict, 401: dict, 403: dict},
    summary="Обменять refresh на новую пару токенов",
)
@requires(PUBLIC)
def platform_refresh(request: HttpRequest, payload: PlatformRefreshIn):
    """
    Та же ручка, что у отеля, и та же реализация под ней (`refresh_session`) —
    механизм сессии в консоли и в CMS один, а не два.

    Рубеж «откуда» действует и здесь: обновление — это выдача нового доступа,
    и разрешать её с адреса вне allowlist значило бы оставить чёрный ход
    ровно там, где парадный вход закрыт.
    """
    from apps.accounts.services import AuthenticationFailed
    from apps.accounts.services.platform_access import client_ip, ip_allowed
    from apps.accounts.services.services import refresh_session

    if not ip_allowed(request):
        return 403, {
            "detail": "Вход в платформу с этого адреса запрещён",
            "code": "ip_not_allowed",
            "ip": client_ip(request),
        }
    try:
        return 200, refresh_session(payload.refresh, scope="platform")
    except AuthenticationFailed as exc:
        return 401, {"detail": str(exc), "code": "session_expired"}


# --- Сессии консоли ---------------------------------------------------------
#
# Тот же слой, что у отеля (apps/accounts/services/sessions.py). Права — SELF:
# человек распоряжается своими сессиями и только ими.


def _sid(request: HttpRequest):
    return (getattr(request.user, "token_claims", None) or {}).get("sid")


@router.post("/auth/logout", summary="Выйти на этом устройстве")
@requires(SELF)
def platform_logout(request: HttpRequest):
    from apps.accounts.services import sessions as session_svc

    session_svc.revoke(_sid(request), user_id=request.user.pk, scope="platform")
    console.audit_platform("platform.logout", actor_id=request.user.pk, ip=request.META.get("REMOTE_ADDR"))
    return {"ok": True}


@router.post("/auth/logout-all", summary="Выйти на всех устройствах")
@requires(SELF)
def platform_logout_all(request: HttpRequest):
    from apps.accounts.services import sessions as session_svc

    closed = session_svc.revoke_all(request.user.pk, scope="platform")
    console.audit_platform(
        "platform.logout_all",
        actor_id=request.user.pk,
        ip=request.META.get("REMOTE_ADDR"),
        payload={"closed": closed},
    )
    return {"ok": True, "closed": closed}


@router.get("/auth/sessions", summary="Мои активные сессии")
@requires(SELF)
def platform_sessions(request: HttpRequest):
    from apps.accounts.services import sessions as session_svc

    return session_svc.list_for(request.user.pk, current_id=_sid(request), scope="platform")


@router.delete("/auth/sessions/{session_id}", summary="Закрыть сессию")
@requires(SELF)
def platform_close_session(request: HttpRequest, session_id: str):
    from apps.accounts.services import sessions as session_svc

    return {"ok": session_svc.revoke(session_id, user_id=request.user.pk, scope="platform")}


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
    # Привязку к сессии переносим: иначе новый токен потерял бы `sid`, и
    # «выйти» из него не знало бы, какую строку реестра закрывать.
    claims = getattr(user, "token_claims", None) or {}
    return {
        "ok": True,
        "access": encode_staff_token(user, mfa=True, session_id=claims.get("sid")),
    }


@router.post("/auth/2fa/disable", summary="Выключить 2FA")
@requires(SELF)
def totp_disable(request: HttpRequest):
    user = request.user
    console.save_platform_user(user, totp_enabled=False, totp_secret="")
    console.audit_platform("platform.2fa.disabled", actor_id=user.pk, ip=request.META.get("REMOTE_ADDR"))
    return {"ok": True}
