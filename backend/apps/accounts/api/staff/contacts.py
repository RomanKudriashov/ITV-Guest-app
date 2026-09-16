"""
Свои контакты сотрудника: телефон и мессенджеры.

Под `/staff`, а не `/cms`: контакты есть у каждого, кто вошёл, — у повара и
горничной тоже, а разделов CMS у них нет. Чужие контакты здесь не видны:
всё — о том, кто сделал запрос.
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Schema

from apps.accounts.services import contacts as svc

from .auth import router, staff_auth


class PhoneIn(Schema):
    phone: str = ""


@router.get("/me/contacts", auth=staff_auth, summary="Мои контакты")
def my_contacts(request: HttpRequest):
    return svc.contacts_of(request.user)


@router.patch("/me/contacts", auth=staff_auth, summary="Изменить свой телефон")
def update_my_contacts(request: HttpRequest, payload: PhoneIn):
    return svc.update_own_phone(request.user, payload.phone)


@router.post(
    "/me/contacts/{messenger}/binding-code",
    auth=staff_auth,
    summary="Одноразовый код привязки мессенджера",
)
def issue_binding_code(request: HttpRequest, messenger: str):
    """
    Пока бот не заведён — `409 binding_unavailable`. Код показывается один раз;
    в базе остаётся только его хэш.
    """
    return svc.issue_code(request.user, messenger)


@router.delete("/me/contacts/{messenger}", auth=staff_auth, summary="Отвязать мессенджер")
def unlink_messenger(request: HttpRequest, messenger: str):
    return svc.unlink(request.user, messenger)
