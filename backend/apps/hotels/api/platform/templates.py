"""Шаблоны онбординга и системный справочник платформы."""

from __future__ import annotations

from django.http import HttpRequest

from apps.hotels.api.platform.rights import OWNER, PUBLIC, READ, WRITE, PlatformRouter, requires
from apps.hotels.schemas.platform import DictionaryEntryIn, TemplateIn
from apps.hotels.services.platform import console

router = PlatformRouter(tags=["platform"])


@router.get("/templates", summary="Шаблоны онбординга")
@requires(READ)
def list_onboarding_templates(request: HttpRequest, limit: int = 100, search: str = ""):
    from apps.hotels.services.onboarding import ensure_seed, list_templates

    # Пустая база даёт владельцу платформы пустой экран и вопрос «а что бывает».
    ensure_seed()
    return list_templates(limit=limit, search=search)


@router.post("/templates", response={201: dict}, summary="Создать шаблон")
@requires(WRITE)
def create_template(request: HttpRequest, payload: TemplateIn):
    from apps.hotels.services import onboarding

    template = onboarding.create_template(payload.dict(exclude_unset=True))
    console.audit_platform(
        "platform.template.created",
        actor_id=request.user.pk,
        ip=request.META.get("REMOTE_ADDR"),
        payload={"code": template.code},
    )
    return 201, onboarding.serialize_template(template)


@router.patch("/templates/{template_id}", summary="Изменить шаблон")
@requires(WRITE)
def patch_template(request: HttpRequest, template_id: str, payload: TemplateIn):
    from apps.hotels.services import onboarding

    template = onboarding.update_template(template_id, payload.dict(exclude_unset=True))
    console.audit_platform(
        "platform.template.updated",
        actor_id=request.user.pk,
        ip=request.META.get("REMOTE_ADDR"),
        payload={"code": template.code},
    )
    return onboarding.serialize_template(template)


@router.get("/dictionaries", summary="Системный справочник платформы")
@requires(READ)
def get_system_dictionary(request: HttpRequest, kind: str | None = None, limit: int = 100, search: str = ""):
    from apps.hotels.services.onboarding import ensure_seed, list_dictionary

    ensure_seed()
    return list_dictionary(kind, limit=limit, search=search)


@router.put("/dictionaries", summary="Добавить/изменить запись справочника")
@requires(WRITE)
def put_system_dictionary(request: HttpRequest, payload: DictionaryEntryIn):
    from apps.hotels.services.onboarding import upsert_dictionary_entry

    entry = upsert_dictionary_entry(
        kind=payload.kind, code=payload.code, title=payload.title, is_active=payload.is_active
    )
    console.audit_platform(
        "platform.dictionary.updated",
        actor_id=request.user.pk,
        ip=request.META.get("REMOTE_ADDR"),
        payload={"kind": entry.kind, "code": entry.code},
    )
    return {
        "id": str(entry.pk), "kind": entry.kind, "code": entry.code,
        "title": entry.title, "is_active": entry.is_active, "sort_order": entry.sort_order,
    }
