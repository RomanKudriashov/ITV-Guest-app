"""
Публикация платформы — ручки консоли.

ПРАВО ПО ВЕСУ проверяется В СЕРВИСЕ, а не декоратором: декоратор статичен и не
различает «на группу» и «на весь флот», а это разные по весу действия. Ручка
объявлена `WRITE` — рубеж по умолчанию, — и внутри спрашивается владелец, если
цель весь флот.
"""

from __future__ import annotations

from django.http import HttpRequest

from apps.hotels.api.platform.rights import READ, WRITE, PlatformRouter, requires
from apps.hotels.schemas.platform import PublicationIn
from apps.hotels.services.platform import console, publication as publication_svc

router = PlatformRouter(tags=["platform"])


@router.post("/publications/preview", summary="Предпросмотр: к скольким применится")
# ПРАВО ИЗМЕНЯЮЩЕЙ, хотя запрос ничего не меняет: POST с правом «read» тихо
# открывает ручку роли «только чтение» (сторож прав ловит это отдельно), а
# предпросмотр — часть публикации. Наблюдатель не публикует, и смотреть, к
# скольким отелям применилось бы то, чего он не может запустить, ему незачем.
@requires(WRITE)
def preview_publication(request: HttpRequest, payload: PublicationIn):
    """
    Считает ТЕМ ЖЕ кодом, что и применение. Разные подсчёты давали бы «47» на
    экране и сорок восемь в отчёте, и объяснить это было бы нечем.
    """
    return publication_svc.preview(
        kind=payload.kind,
        payload=payload.payload,
        scope=payload.scope,
        group_id=payload.group_id,
        hotel_ids=payload.hotel_ids,
        user=request.user,
    )


@router.post("/publications", response={201: dict}, summary="Опубликовать")
@requires(WRITE)
def create_publication(request: HttpRequest, payload: PublicationIn):
    publication_svc.check_rights(request.user, payload.scope)
    job = publication_svc.start(
        kind=payload.kind,
        payload=payload.payload,
        scope=payload.scope,
        group_id=payload.group_id,
        hotel_ids=payload.hotel_ids,
        actor_id=request.user.pk,
        user=request.user,
    )
    console.audit_platform(
        "platform.publication.started",
        actor_id=request.user.pk,
        ip=request.META.get("REMOTE_ADDR"),
        payload={"kind": job.kind, "scope": job.scope, "planned": job.planned},
    )
    return 201, publication_svc.serialize(job)


@router.get("/publications", summary="История публикаций")
@requires(READ)
def list_publications(request: HttpRequest, limit: int = 50):
    return {"items": publication_svc.history(limit=limit)}


@router.get("/publications/{job_id}", summary="Отчёт по каждому отелю")
@requires(READ)
def publication_report(request: HttpRequest, job_id: str):
    return publication_svc.serialize(publication_svc.get(job_id), with_results=True)
