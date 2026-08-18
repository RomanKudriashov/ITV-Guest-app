"""
Аутентификация персонала.

Логин всегда в рамках отеля: тенант уже выбран поддоменом, и сотрудник одного
отеля не войдёт на поддомене другого — проверка в сервисном слое.
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router
from apps.accounts.schemas.cms import LoginIn, LoginOut, MeOut, RefreshIn, SupportExchangeIn

from apps.accounts.services.auth import StaffAuth
from apps.accounts.models import User
from apps.accounts.services import AuthenticationFailed, authenticate_staff_credentials
from apps.accounts.services.session import staff_user, staff_login_hotel


router = Router(tags=["staff"])
staff_auth = StaffAuth()


def serialize_user(user: User) -> dict:
    from apps.accounts.services.roles import access_for

    return {
        "id": str(user.pk),
        "email": user.email,
        "full_name": user.full_name,
        "language": user.language or "",
        "is_hotel_admin": user.is_hotel_admin,
        "is_platform_admin": user.is_platform_admin,
        # Роль и её область — чтобы фронт вёл линейного сотрудника сразу в
        # трекер и не рисовал ему разделы, которые всё равно ответят 403.
        **access_for(user).payload(),
    }


@router.post(
    "/auth/support-exchange",
    response={200: dict, 401: dict},
    auth=None,
    summary="Обменять одноразовый код входа поддержки на токен",
)
def support_exchange(request: HttpRequest, payload: SupportExchangeIn):
    """
    Обмен идёт СО СТОРОНЫ ОТЕЛЯ и по его поддомену: тенант уже выбран адресом,
    и код чужого отеля здесь не сработает.

    `auth=None` — у вошедшего ещё нет токена, он его как раз и получает.
    Секретом служит сам код: одноразовый, живёт минуту, гасится обменом.
    """
    from apps.accounts.services.services import exchange_impersonation_code
    from apps.hotels.services.hotel import current_hotel

    try:
        return 200, exchange_impersonation_code(payload.code, hotel=current_hotel())
    except AuthenticationFailed as exc:
        return 401, {"detail": str(exc), "code": "support_code_invalid"}


@router.post("/auth/login", response={200: LoginOut, 401: dict}, auth=None, summary="Вход")
def login(request: HttpRequest, payload: LoginIn):
    try:
        tokens = authenticate_staff_credentials(payload.email, payload.password, request=request)
    except AuthenticationFailed as exc:
        return 401, {"detail": str(exc), "code": "auth_failed"}

    from apps.hotels.services.brand_services import get_or_create_brand

    user = staff_user(tokens["user_id"])
    theme = get_or_create_brand(staff_login_hotel())
    return 200, {
        "access": tokens["access"],
        "refresh": tokens["refresh"],
        "user": serialize_user(user),
        "theme": (theme.tokens if theme else {}) or {},
    }


@router.post(
    "/auth/refresh",
    response={200: dict, 401: dict},
    auth=None,
    summary="Обменять refresh на новую пару токенов",
)
def refresh(request: HttpRequest, payload: RefreshIn):
    """
    `auth=None` — предъявляемый секрет здесь сам refresh, а access к этому
    моменту уже протух: требовать его значило бы требовать ровно то, за чем
    сюда и пришли.

    Вход поддержки этой ручкой НЕ ПРОДЛЕВАЕТСЯ: refresh выдаётся только
    паролем, обмен одноразового кода отдаёт один access со сроком гранта.
    Продлить сессию поддержки нечем — и это не случайность, а условие: у
    входа под аудитом свой срок, и он обязан кончаться вовремя.
    """
    from apps.accounts.services.services import refresh_session

    try:
        return 200, refresh_session(
            payload.refresh, scope="staff", hotel_id=staff_login_hotel().pk
        )
    except AuthenticationFailed as exc:
        return 401, {"detail": str(exc), "code": "session_expired"}


# --- Сессии: выход и список ------------------------------------------------
#
# Ручки тонкие: вся работа в apps/accounts/services/sessions.py, тот же слой
# зовёт и консоль платформы. Механизм сессии один на обе области.


def _current_session_id(request: HttpRequest):
    return (getattr(request.user, "token_claims", None) or {}).get("sid")


@router.post("/auth/logout", auth=staff_auth, summary="Выйти на этом устройстве")
def logout(request: HttpRequest):
    """
    Рвёт ТОЛЬКО эту сессию. Остальные устройства продолжают работать: выход на
    рабочем ноутбуке не должен выкидывать человека с телефона.
    """
    from apps.accounts.services import sessions as session_svc

    session_svc.revoke(_current_session_id(request), user_id=request.user.pk)
    return {"ok": True}


@router.post("/auth/logout-all", auth=staff_auth, summary="Выйти на всех устройствах")
def logout_all(request: HttpRequest):
    """Все сессии учётки, включая текущую. Это ответ на «токен украли»."""
    from apps.accounts.services import sessions as session_svc

    closed = session_svc.revoke_all(request.user.pk)
    return {"ok": True, "closed": closed}


@router.get("/auth/sessions", auth=staff_auth, summary="Мои активные сессии")
def my_sessions(request: HttpRequest):
    from apps.accounts.services import sessions as session_svc

    return session_svc.list_for(
        request.user.pk, current_id=_current_session_id(request)
    )


@router.delete("/auth/sessions/{session_id}", auth=staff_auth, summary="Закрыть сессию")
def close_session(request: HttpRequest, session_id: str):
    """Закрыть можно только СВОЮ сессию — чужая по идентификатору не найдётся."""
    from apps.accounts.services import sessions as session_svc

    return {"ok": session_svc.revoke(session_id, user_id=request.user.pk)}


@router.get("/auth/me", response=MeOut, auth=staff_auth, summary="Текущий пользователь")
def me(request: HttpRequest):
    from apps.hotels.services.brand_services import get_or_create_brand

    hotel = staff_login_hotel()
    theme = get_or_create_brand(hotel)
    return {
        "user": serialize_user(request.user),
        "hotel": {
            "id": str(hotel.pk),
            "name": hotel.name_i18n,
            "subdomain": hotel.subdomain,
            "currency": hotel.currency,
            "default_language": hotel.default_language,
        },
        # Тот же набор токенов, что получает гость: у отеля одна тема, и
        # персонал обязан видеть её же — иначе «бренд» существует только на
        # витрине, а сотрудник работает в чужих цветах.
        "theme": (theme.tokens if theme else {}) or {},
    }
