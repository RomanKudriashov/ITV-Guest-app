"""
ЧЕРНОВИКИ, ВЕРСИИ И ОТКАТ ОФОРМЛЕНИЯ.

ЧТО БЫЛО. Одна строка токенов и кнопка «Сохранить», писавшая прямо в витрину.
Черновик жил в браузере: закрыл вкладку — работы нет. Двое правивших не знали
друг о друге вовсе: выигрывал сохранивший вторым, и молча. Вернуться к
предыдущему оформлению было НЕЧЕМ — предыдущего не существовало.

ЧТО ЗДЕСЬ. Снимок токенов с автором и временем: черновик — снимок, который
видит только панель; публикация — снимок, который видит гость. Живут в одной
таблице по одной причине: откат обязан возвращать ТЕ ЖЕ токены, а не «почти те»,
и разным полям для этого взяться неоткуда.

ПУБЛИКАЦИЯ ВСЕГДА ОСТАВЛЯЕТ СЛЕД. Прямое сохранение из редактора — тоже
публикация, и она тоже пишет версию: история с дырами хуже, чем её отсутствие,
потому что выглядит полной.
"""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from apps.accounts.services.roles import require_hotel_admin
from apps.core.context import current_actor
from apps.core.errors import ValidationError
from apps.hotels.models import BrandVersion

from .brand_services import get_or_create_brand


def _actor():
    """Кто сейчас работает. Может не быть — тогда автор останется неизвестным."""
    actor = current_actor()
    return actor if getattr(actor, "pk", None) else None


def _author_name(user) -> str:
    if user is None:
        return ""
    full = " ".join(filter(None, [getattr(user, "first_name", ""), getattr(user, "last_name", "")]))
    return (full or getattr(user, "email", "") or "").strip()[:180]


def current_published() -> BrandVersion | None:
    """Опубликованная сейчас версия — та, у которой наибольший номер."""
    return (
        BrandVersion.objects.filter(kind=BrandVersion.Kind.PUBLISHED)
        .order_by("-number")
        .first()
    )


def _next_number() -> int:
    last = current_published()
    return (last.number or 0) + 1 if last else 1


def serialize(version: BrandVersion, *, with_tokens: bool = False) -> dict:
    """
    Версия на выдачу.

    Токены по умолчанию НЕ отдаются: списки читают оба экрана и по многу строк
    сразу, а снимок оформления — это килобайты на каждую. Кому нужен снимок
    (предпросмотр, откат), тот спрашивает версию поимённо.
    """
    data = {
        "id": str(version.pk),
        "kind": version.kind,
        "name": version.name,
        "number": version.number,
        "author": version.author_name,
        "created_at": version.created_at.isoformat(),
        "published_at": version.published_at.isoformat() if version.published_at else None,
        "restored_from": (
            {
                "id": str(version.restored_from_id),
                "number": version.restored_from.number,
            }
            if version.restored_from_id and version.restored_from
            else None
        ),
        "base_version": (
            {
                "id": str(version.base_version_id),
                "number": version.base_version.number if version.base_version else None,
            }
            if version.base_version_id and version.base_version
            else None
        ),
        "is_stale": version.is_stale,
    }
    if with_tokens:
        data["tokens"] = version.tokens
    return data


# --- Черновики -------------------------------------------------------------


def list_drafts() -> list[dict]:
    require_hotel_admin()
    drafts = (
        BrandVersion.objects.filter(kind=BrandVersion.Kind.DRAFT)
        .select_related("base_version")
        .order_by("-created_at")
    )
    return [serialize(draft) for draft in drafts]


def create_draft(*, name: str, tokens: dict) -> dict:
    """
    Новый черновик от ТЕКУЩЕЙ опубликованной версии.

    Основание запоминается сразу и навсегда: сторож устаревшего черновика
    сравнивает именно его, и вычислить задним числом «от чего это начинали»
    будет уже неоткуда.
    """
    require_hotel_admin()
    user = _actor()
    draft = BrandVersion.objects.create(
        kind=BrandVersion.Kind.DRAFT,
        name=(name or "").strip()[:120],
        tokens=tokens or {},
        author=user,
        author_name=_author_name(user),
        base_version=current_published(),
    )
    return serialize(draft, with_tokens=True)


def get_draft(draft_id) -> dict:
    require_hotel_admin()
    return serialize(_draft_or_error(draft_id), with_tokens=True)


def update_draft(draft_id, *, name: str | None = None, tokens: dict | None = None) -> dict:
    require_hotel_admin()
    draft = _draft_or_error(draft_id)
    if name is not None:
        draft.name = name.strip()[:120]
    if tokens is not None:
        draft.tokens = tokens
    draft.save(update_fields=["name", "tokens", "updated_at"])
    return serialize(draft, with_tokens=True)


def delete_draft(draft_id) -> None:
    require_hotel_admin()
    _draft_or_error(draft_id).delete()


def _draft_or_error(draft_id) -> BrandVersion:
    draft = BrandVersion.objects.filter(pk=draft_id, kind=BrandVersion.Kind.DRAFT).first()
    if draft is None:
        raise ValidationError("Черновик не найден", field="draft", code="draft_not_found")
    return draft


# --- Публикация ------------------------------------------------------------


@transaction.atomic
def publish_tokens(
    tokens: dict,
    *,
    name: str = "",
    restored_from: BrandVersion | None = None,
) -> BrandVersion:
    """
    Положить снимок в витрину и записать версию.

    Одна дверь на все три случая — прямое сохранение, публикация черновика и
    откат, — потому что все три делают одно и то же: меняют то, что видит
    гость. Разные двери разошлись бы, и какая-то перестала бы писать историю.
    """
    theme = get_or_create_brand()
    theme.tokens = tokens
    theme.save(update_fields=["tokens", "updated_at"])

    user = _actor()
    return BrandVersion.objects.create(
        kind=BrandVersion.Kind.PUBLISHED,
        name=(name or "").strip()[:120],
        number=_next_number(),
        tokens=tokens,
        author=user,
        author_name=_author_name(user),
        restored_from=restored_from,
        published_at=timezone.now(),
    )


def publish_draft(draft_id, *, confirm_stale: bool = False) -> dict:
    """
    Опубликовать черновик.

    УСТАРЕВШИЙ ЧЕРНОВИК НЕ ПУБЛИКУЕТСЯ МОЛЧА. Пока оператор правил, витрину мог
    опубликовать кто-то другой; такой черновик не «немного отстал» — он не знает
    о чужой работе ВООБЩЕ и сотрёт её целиком. Отказ называет обе версии, а
    подтверждение — отдельное осознанное действие, а не галочка по умолчанию.
    """
    require_hotel_admin()
    draft = _draft_or_error(draft_id)

    if draft.is_stale and not confirm_stale:
        current = current_published()
        raise ValidationError(
            "Черновик начат от версии "
            + (f"{draft.base_version.number}" if draft.base_version else "до первой публикации")
            + f", а сейчас опубликована версия {current.number if current else '—'}. "
            "Публикация сотрёт чужие правки целиком.",
            field="draft",
            code="draft_stale",
        )

    version = publish_tokens(draft.tokens, name=draft.name)
    draft.delete()
    return serialize(version)


# --- История и откат -------------------------------------------------------


def list_versions(limit: int = 50) -> list[dict]:
    require_hotel_admin()
    versions = (
        BrandVersion.objects.filter(kind=BrandVersion.Kind.PUBLISHED)
        .select_related("restored_from")
        .order_by("-number")[:limit]
    )
    return [serialize(version) for version in versions]


def restore_version(version_id) -> dict:
    """
    Откат — это НОВАЯ публикация со старыми токенами, а не отматывание истории.

    Стереть версии между «сейчас» и «тогда» значило бы сделать вид, что их не
    было. Они были, витрина их показывала, и гость мог заказать по тому меню.
    Поэтому откат ложится сверху и подписан как откат: кто, когда и к чему
    вернул.
    """
    require_hotel_admin()
    source = BrandVersion.objects.filter(
        pk=version_id, kind=BrandVersion.Kind.PUBLISHED
    ).first()
    if source is None:
        raise ValidationError("Версия не найдена", field="version", code="version_not_found")

    version = publish_tokens(source.tokens, name=source.name, restored_from=source)
    return serialize(version)
