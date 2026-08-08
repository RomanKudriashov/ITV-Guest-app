"""
Аутентификация персонала.

Логин всегда в рамках отеля: тенант уже выбран поддоменом, и сотрудник одного
отеля не войдёт на поддомене другого — проверка в сервисном слое.
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router
from apps.accounts.schemas.cms import LoginIn, LoginOut, MeOut

from apps.accounts.auth import StaffAuth
from apps.accounts.models import User
from apps.accounts.services import AuthenticationFailed, authenticate_staff_credentials
from apps.core.context import require_hotel_id
from apps.hotels.models import Hotel


router = Router(tags=["staff"])
staff_auth = StaffAuth()


def serialize_user(user: User) -> dict:
    from apps.accounts.roles import access_for

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


@router.post("/auth/login", response={200: LoginOut, 401: dict}, auth=None, summary="Вход")
def login(request: HttpRequest, payload: LoginIn):
    try:
        tokens = authenticate_staff_credentials(payload.email, payload.password)
    except AuthenticationFailed as exc:
        return 401, {"detail": str(exc), "code": "auth_failed"}

    from apps.hotels.brand_services import get_or_create_brand

    user = User.objects.get(pk=tokens["user_id"])
    theme = get_or_create_brand(Hotel.objects.get(pk=require_hotel_id()))
    return 200, {
        "access": tokens["access"],
        "refresh": tokens["refresh"],
        "user": serialize_user(user),
        "theme": (theme.tokens if theme else {}) or {},
    }


@router.get("/auth/me", response=MeOut, auth=staff_auth, summary="Текущий пользователь")
def me(request: HttpRequest):
    from apps.hotels.brand_services import get_or_create_brand

    hotel = Hotel.objects.get(pk=require_hotel_id())
    theme = get_or_create_brand(hotel)
    return {
        "user": serialize_user(request.user),
        "hotel": {
            "id": str(hotel.pk),
            "name": hotel.name,
            "subdomain": hotel.subdomain,
            "currency": hotel.currency,
            "default_language": hotel.default_language,
        },
        # Тот же набор токенов, что получает гость: у отеля одна тема, и
        # персонал обязан видеть её же — иначе «бренд» существует только на
        # витрине, а сотрудник работает в чужих цветах.
        "theme": (theme.tokens if theme else {}) or {},
    }
