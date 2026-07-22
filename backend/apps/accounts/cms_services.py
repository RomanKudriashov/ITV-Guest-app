"""
Сервисный слой управления персоналом.

Закрывает пробел прогона 6: GET /api/cms/staff даёт список сотрудников для
выбора в персональном канале уведомлений. Плюс CRUD и привязки к отделам.
"""

from __future__ import annotations

from typing import Iterable

from django.contrib.auth.hashers import make_password
from django.db import transaction

from apps.core.context import require_hotel_id
from apps.core.errors import ConflictError, NotFoundError, ValidationError
from apps.hotels.models import ExecutionPoint

from .models import StaffAssignment, User

MIN_PASSWORD_LENGTH = 8


def serialize_assignment(assignment: StaffAssignment) -> dict:
    return {
        "id": str(assignment.pk),
        "execution_point_id": str(assignment.execution_point_id),
        "execution_point_code": assignment.execution_point.code,
        "level": assignment.level,
        "is_active": assignment.is_active,
    }


def serialize_staff(user: User) -> dict:
    return {
        "id": str(user.pk),
        "email": user.email,
        "full_name": user.full_name,
        "language": user.language or "",
        "is_hotel_admin": user.is_hotel_admin,
        "is_active": user.is_active,
        "assignments": [
            serialize_assignment(assignment)
            for assignment in user.assignments.select_related("execution_point").all()
        ],
    }


def list_staff() -> list[dict]:
    users = (
        User.objects.filter(is_staff_member=True)
        .prefetch_related("assignments__execution_point")
        .order_by("full_name", "email")
    )
    return [serialize_staff(user) for user in users]


def get_staff(user_id) -> User:
    user = (
        User.objects.filter(pk=user_id, is_staff_member=True)
        .prefetch_related("assignments__execution_point")
        .first()
    )
    if user is None:
        raise NotFoundError("Сотрудник не найден")
    return user


def _validate_password(password: str) -> None:
    if len(password or "") < MIN_PASSWORD_LENGTH:
        raise ValidationError(
            f"Пароль не короче {MIN_PASSWORD_LENGTH} символов",
            field="password",
            code="weak_password",
        )


def _resolve_point(execution_point_id) -> ExecutionPoint:
    # RLS не отдаст точку чужого отеля — попытка привязать к ней вернёт «не
    # найдено», а не утечёт факт её существования.
    point = ExecutionPoint.objects.filter(pk=execution_point_id).first()
    if point is None:
        raise ValidationError("Отдел не найден", field="execution_point_id")
    return point


@transaction.atomic
def _replace_assignments(user: User, assignments: Iterable[dict]) -> None:
    StaffAssignment.objects.filter(user=user).hard_delete()
    valid_levels = set(dict(StaffAssignment.Level.choices))
    for entry in assignments or []:
        point = _resolve_point(entry.get("execution_point_id"))
        level = entry.get("level") or StaffAssignment.Level.MEMBER
        if level not in valid_levels:
            raise ValidationError(f"Неизвестный уровень: {level}", field="level")
        StaffAssignment.objects.create(
            hotel_id=user.hotel_id, user=user, execution_point=point, level=level
        )


@transaction.atomic
def create_staff(data: dict) -> User:
    email = str(data.get("email") or "").strip().lower()
    if not email:
        raise ValidationError("Укажите email", field="email")
    if User.all_objects.filter(email=email).exists():
        raise ConflictError("Этот email уже занят", code="email_taken")

    password = data.get("password") or ""
    _validate_password(password)

    user = User.objects.create(
        hotel_id=require_hotel_id(),
        email=email,
        full_name=str(data.get("full_name") or "").strip(),
        language=str(data.get("language") or "").strip(),
        is_hotel_admin=data.get("is_hotel_admin", False),
        is_staff_member=True,
        password=make_password(password),
    )
    _replace_assignments(user, data.get("assignments") or [])
    return get_staff(user.pk)


@transaction.atomic
def update_staff(user_id, data: dict, *, acting_user_id=None) -> User:
    user = get_staff(user_id)

    if "email" in data:
        email = str(data["email"] or "").strip().lower()
        if not email:
            raise ValidationError("Укажите email", field="email")
        if User.all_objects.filter(email=email).exclude(pk=user.pk).exists():
            raise ConflictError("Этот email уже занят", code="email_taken")
        user.email = email
    if "full_name" in data:
        user.full_name = str(data["full_name"] or "").strip()
    if "language" in data:
        user.language = str(data["language"] or "").strip()
    if "is_hotel_admin" in data:
        user.is_hotel_admin = data["is_hotel_admin"]
    if "is_active" in data:
        if data["is_active"] is False:
            _guard_self(user, acting_user_id, "деактивировать")
        user.is_active = data["is_active"]
    # Пустой пароль в PATCH — «не менять», как маска секрета у каналов.
    if data.get("password"):
        _validate_password(data["password"])
        user.password = make_password(data["password"])

    user.save()
    if "assignments" in data:
        _replace_assignments(user, data["assignments"])
    return get_staff(user.pk)


@transaction.atomic
def replace_assignments(user_id, assignments: Iterable[dict]) -> User:
    user = get_staff(user_id)
    _replace_assignments(user, assignments)
    return get_staff(user.pk)


def delete_staff(user_id, *, acting_user_id=None) -> None:
    user = get_staff(user_id)
    _guard_self(user, acting_user_id, "удалить")
    StaffAssignment.objects.filter(user=user).delete()
    user.delete()


def _guard_self(user: User, acting_user_id, action: str) -> None:
    """
    Себя нельзя удалить или выключить: иначе единственный админ запрёт себя
    снаружи, и войти будет некому. Действующего пользователя вьюха передаёт
    явно — в CMS-запросе он не лежит в контексте актора.
    """
    if acting_user_id is not None and str(acting_user_id) == str(user.pk):
        raise ConflictError(
            f"Нельзя {action} собственную учётную запись", code="cannot_remove_self"
        )
