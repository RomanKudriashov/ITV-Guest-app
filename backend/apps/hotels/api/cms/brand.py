"""
CMS: бренд-настройки. Контракт — docs/brand-api-contract.md.

Вьюхи тонкие: вся валидация и merge — в apps/hotels/services/brand_services.py.
"""

from __future__ import annotations

from pathlib import Path

from django.http import HttpRequest
from ninja import File, Router, Schema
from ninja.files import UploadedFile

from apps.accounts.services.roles import require_hotel_admin
from apps.core.context import current_language
from apps.core.errors import ValidationError
from apps.hotels.brand_library import (
    ABSTRACTIONS,
    FONT_MAX_BYTES,
    FONT_SIGNATURES,
    FONTS,
    font_family_of,
    list_presets,
)
from apps.media.services import store_ready_asset
from apps.hotels.schemas.cms import ApplyPresetIn, BrandOut, BrandPatch
from apps.hotels.services import brand_services as svc
from apps.hotels.services import brand_versions as versions_svc
from apps.hotels.services.hotel import current_hotel

router = Router(tags=["cms:brand"])


@router.get("/brand", response=BrandOut, summary="Текущая тема отеля")
def get_brand(request: HttpRequest):
    # ОФОРМЛЕНИЕ ОТЕЛЯ ЧИТАЕТ ТОЛЬКО АДМИН. Правка темы давно требовала прав
    # администратора, а чтение отдавалось любому управляющему — при том, что
    # экран «Бренд» ему не показан вовсе. Тема отеля не нужна для работы
    # заведения ни в одном сценарии.
    require_hotel_admin()
    return svc.serialize_brand(svc.get_or_create_brand())


@router.patch("/brand", response=BrandOut, summary="Изменить токены (deep-merge)")
def patch_brand(request: HttpRequest, payload: BrandPatch):
    theme = svc.update_brand(payload.tokens or {})
    return svc.serialize_brand(theme)


@router.put("/brand", response=BrandOut, summary="Заменить набор токенов целиком")
def put_brand(request: HttpRequest, payload: BrandPatch):
    """
    PATCH правит, PUT заменяет. Разница принципиальна для ВОЗВРАТА состояния:
    deep-merge не умеет убрать ключ, а значит не умеет откатить.
    """
    theme = svc.replace_brand(payload.tokens or {})
    return svc.serialize_brand(theme)


@router.get("/brand/preview", summary="Показ витрины: те же данные, что увидит гость")
def brand_preview(
    request: HttpRequest,
    screen: str = "home",
    group: str = "",
    point: str = "",
    type: str = "product",
    item_id: str = "",
    room: str = "",
):
    """
    Данные ОДНОГО экрана показа, в той же форме, в какой их получает гость.

    ОБЪЯВЛЕНА ВЫШЕ `/brand` с параметрами и ниже самого `/brand`: путь
    статический, но соседи по файлу динамических сегментов не имеют, так что
    порядок здесь про читаемость, а не про маршрутизацию.

    Гостевой сессии не заводит — см. `apps/hotels/services/brand_preview.py`.
    """
    from apps.hotels.services.brand_preview import preview_payload

    return preview_payload(
        current_hotel(),
        screen=screen,
        language=current_language(),
        group=group,
        point=point,
        offering_type=type,
        item_id=item_id,
        room_number=room,
    )


@router.post("/brand/font", summary="Загрузить свой шрифт отеля")
def upload_brand_font(request: HttpRequest, file: UploadedFile = File(...), name: str = ""):
    """
    Файл шрифта отеля: кладём, проверяем ПО СИГНАТУРЕ и возвращаем семейство.

    Токены здесь не трогаем намеренно. Загрузка и ВЫБОР — разные решения:
    оператор может принести файл и передумать, а подменить ему шрифт в тот же
    миг значило бы решить за него. Ответ несёт готовую строку семейства —
    клиент кладёт её в `typography.fontFamily`, когда оператор этого захочет.

    ЛИЦЕНЗИЮ НА ФАЙЛ МЫ ПРОВЕРИТЬ НЕ МОЖЕМ. Право на шрифт подтверждает отель;
    в интерфейсе это сказано словами рядом с кнопкой, а не спрятано в согласии.
    """
    require_hotel_admin()

    content = file.read()
    if len(content) > FONT_MAX_BYTES:
        raise ValidationError(
            f"Файл шрифта больше {FONT_MAX_BYTES // (1024 * 1024)} МБ",
            field="file",
            code="font_too_large",
        )

    signature = next(
        (value for prefix, value in FONT_SIGNATURES.items() if content.startswith(prefix)),
        None,
    )
    if signature is None:
        raise ValidationError(
            "Это не файл шрифта. Подходят woff2, woff, otf и ttf",
            field="file",
            code="not_a_font",
        )
    suffix, content_type = signature

    family_name = _font_name(name or Path(file.name or "").stem)
    asset = store_ready_asset(
        content=content,
        filename=f"{family_name}.{suffix}",
        kind="font",
        content_type=content_type,
    )

    return {
        "assetId": str(asset.pk),
        "name": family_name,
        "family": font_family_of(family_name),
        "url": asset.url("original"),
        "format": suffix,
    }


def _font_name(raw: str) -> str:
    """
    Имя семейства из имени файла — пригодное для CSS и узнаваемое человеком.

    Оставляем буквы, цифры, пробел и дефис: имя уезжает в `font-family`, и
    кавычка или точка с запятой там — это сломанная тема, а в худшем случае
    чужое правило в нашем стиле. Пусто — значит «Свой шрифт»: безымянное
    семейство оператор потом не опознает в списке.
    """
    import re

    cleaned = re.sub(r"[^\w \-]", "", raw, flags=re.UNICODE).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)[:40]
    return cleaned or "Свой шрифт"


# --- Черновики, версии, откат ----------------------------------------------
#
# ПОРЯДОК ОБЪЯВЛЕНИЯ ЗДЕСЬ ЗНАЧИМ. Статические пути объявляются ВЫШЕ путей с
# динамическим сегментом: иначе `/brand/drafts` попадёт в обработчик
# `/brand/{something}` и вернёт 405 — на этом мы уже обжигались с бейджами.


class DraftIn(Schema):
    name: str = ""
    tokens: dict = {}


class DraftPatch(Schema):
    name: str | None = None
    tokens: dict | None = None


@router.get("/brand/drafts", summary="Черновики оформления")
def brand_drafts(request: HttpRequest):
    """
    ЧЕРНОВИКОВ НЕСКОЛЬКО. Оператор готовит новогоднее оформление, открытие
    террасы и «просто попробовать» — это разные замыслы, и держать их по одному
    значит заставлять выбирать, что потерять.
    """
    return {"drafts": versions_svc.list_drafts()}


@router.post("/brand/drafts", summary="Создать черновик")
def create_brand_draft(request: HttpRequest, payload: DraftIn):
    return versions_svc.create_draft(name=payload.name, tokens=payload.tokens)


@router.get("/brand/versions", summary="История публикаций")
def brand_versions(request: HttpRequest, limit: int = 50):
    return {"versions": versions_svc.list_versions(limit=limit)}


@router.post("/brand/versions/{version_id}/restore", summary="Вернуть эту версию")
def restore_brand_version(request: HttpRequest, version_id: str):
    """
    Откат ложится СВЕРХУ новой публикацией и подписан как откат.

    Стирать версии между «сейчас» и «тогда» нельзя: они были, витрина их
    показывала, и гость заказывал по тому меню.
    """
    return versions_svc.restore_version(version_id)


@router.get("/brand/drafts/{draft_id}", summary="Черновик целиком")
def brand_draft(request: HttpRequest, draft_id: str):
    return versions_svc.get_draft(draft_id)


@router.patch("/brand/drafts/{draft_id}", summary="Правка черновика")
def patch_brand_draft(request: HttpRequest, draft_id: str, payload: DraftPatch):
    return versions_svc.update_draft(draft_id, name=payload.name, tokens=payload.tokens)


@router.delete("/brand/drafts/{draft_id}", summary="Удалить черновик")
def delete_brand_draft(request: HttpRequest, draft_id: str):
    versions_svc.delete_draft(draft_id)
    return {"ok": True}


@router.post("/brand/drafts/{draft_id}/publish", summary="Опубликовать черновик")
def publish_brand_draft(request: HttpRequest, draft_id: str, confirm_stale: bool = False):
    """
    Устаревший черновик требует подтверждения ОТДЕЛЬНЫМ действием.

    Не галочкой по умолчанию: подтверждение по умолчанию — это не подтверждение,
    а способ стереть чужую работу, не заметив.
    """
    return versions_svc.publish_draft(draft_id, confirm_stale=confirm_stale)


class ScheduleIn(Schema):
    """
    Момент называют В МЕСТНОМ ВРЕМЕНИ ОТЕЛЯ, без часового пояса.

    Пояс сюда не принимается намеренно: прислать его мог бы браузер оператора,
    а он в отпуске в другом часовом поясе — и «полночь» стала бы чужой.
    """

    run_at: str


@router.get("/brand/schedule", summary="Назначенные публикации")
def brand_schedule_list(request: HttpRequest):
    """
    Назначенное ВИДНО. Публикация, о которой знает только таблица, — это
    сюрприз для утренней смены.
    """
    require_hotel_admin()
    from apps.core.services import scheduler
    from apps.hotels.services.brand_schedule import KIND, serialize_job

    return {"scheduled": [serialize_job(job) for job in scheduler.pending_jobs(KIND)]}


@router.post("/brand/drafts/{draft_id}/schedule", summary="Опубликовать по расписанию")
def schedule_brand_draft(request: HttpRequest, draft_id: str, payload: ScheduleIn):
    from apps.hotels.services.brand_schedule import schedule_publication, serialize_job

    return serialize_job(
        schedule_publication(draft_id, local_run_at=payload.run_at, hotel=current_hotel())
    )


@router.delete("/brand/schedule/{job_id}", summary="Отменить назначенную публикацию")
def cancel_brand_schedule(request: HttpRequest, job_id: str):
    """Отмена до срабатывания: после него витрина уже изменилась."""
    require_hotel_admin()
    from apps.core.services import scheduler

    scheduler.cancel(job_id)
    return {"ok": True}


@router.get("/brand/presets", summary="Библиотека пресетов")
def presets(request: HttpRequest):
    # Библиотека оформления — часть админского экрана бренда.
    require_hotel_admin()
    return {"presets": list_presets()}


@router.post("/brand/apply-preset", response=BrandOut, summary="Применить пресет целиком")
def apply_preset(request: HttpRequest, payload: ApplyPresetIn):
    theme = svc.apply_preset(payload.preset)
    return svc.serialize_brand(theme)


@router.get("/brand/fonts", summary="Курируемый список шрифтов")
def fonts(request: HttpRequest):
    # Библиотека оформления — часть админского экрана бренда.
    require_hotel_admin()
    return {"fonts": FONTS}


@router.get("/brand/abstractions", summary="Библиотека фонов-абстракций")
def abstractions(request: HttpRequest):
    # Библиотека оформления — часть админского экрана бренда.
    require_hotel_admin()
    return {"abstractions": ABSTRACTIONS}


@router.get("/brand/look", summary="Своё оформление или пресет платформы")
def cms_brand_look(request: HttpRequest):
    """
    Отелю — тем же словом, что и платформе: «своё оформление», а не
    «расхождение». Экран, предлагающий починить неполоманное, приучает
    нажимать «ок» не глядя.
    """
    from apps.hotels.services import brand_inheritance, hotel_settings as svc

    # Результат не нужен — нужна ПРОВЕРКА ПРАВ внутри: `hotel_for_settings()`
    # зовёт `require_hotel_admin()`. Вызов без присваивания читается как
    # забытая строка, поэтому сказано прямо.
    svc.hotel_for_settings()
    return brand_inheritance.look_of_current_hotel()
