"""
Медиапайплайн. Всё тяжёлое и всё, что ходит наружу, — в Celery с ретраями.
"""

from __future__ import annotations

import io
import logging
import uuid

from celery import shared_task
from django.conf import settings
from PIL import Image, ImageOps

from apps.core.context import tenant_context

from apps.media.services import storage
from .models import MediaAsset

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_jitter=True,
    max_retries=5,
    acks_late=True,
)
def process_media_asset(self, asset_id: str, hotel_id: str) -> dict:
    """
    Нарезает варианты из оригинала.

    hotel_id передаётся явным аргументом: у воркера нет HTTP-запроса, а значит
    нет и контекста тенанта — без него RLS не отдаст ни строки.
    """
    with tenant_context(hotel_id):
        asset = MediaAsset.objects.filter(pk=asset_id).first()
        if asset is None:
            logger.warning("Ассет %s не найден (удалён?)", asset_id)
            return {"status": "missing"}

        asset.status = MediaAsset.Status.PROCESSING
        asset.save(update_fields=["status", "updated_at"])

        # ПОД КАКОЙ КАДР РЕЖЕМ. Запоминаем до работы: пока идёт нарезка,
        # человек может выбрать другой кадр и поставить вторую задачу.
        rendered_for = asset.crop

        try:
            raw = storage.get_bytes(asset.object_key)
            variants = _render_variants(raw, asset)
        except Exception as exc:  # noqa: BLE001 — ретраит Celery, состояние фиксируем
            asset.status = MediaAsset.Status.FAILED
            asset.error = str(exc)[:2000]
            asset.save(update_fields=["status", "error", "updated_at"])
            raise

        # УСТАРЕВШАЯ НАРЕЗКА НЕ ПУБЛИКУЕТСЯ.
        #
        # Загрузка ставит первую задачу, обрезка — вторую, и порядок их
        # завершения ничем не задан: первая (по целому кадру) успевает
        # финишировать позже и затирает результат второй. На экране после этого
        # кадр, который человек не выбирал, — и повторить это нельзя, потому что
        # зависит от того, кто из воркеров был быстрее.
        #
        # Сверяем кадр, под который резали, с тем, что в базе СЕЙЧАС. Разошлись
        # — наш результат устарел: молча уходим и не трогаем ни варианты, ни
        # статус. Свежая задача доведёт дело сама.
        current_crop = (
            MediaAsset.objects.filter(pk=asset_id).values_list("crop", flat=True).first()
        )
        if current_crop != rendered_for:
            logger.info("Ассет %s: кадр сменился во время нарезки, результат отброшен", asset_id)
            return {"status": "superseded"}

        asset.variants = variants
        asset.status = MediaAsset.Status.READY
        asset.error = ""
        # width/height проставляет _render_variants — их обязательно перечислить
        # в update_fields, иначе размеры оригинала молча не сохранятся.
        asset.save(
            update_fields=[
                "variants",
                "status",
                "error",
                "width",
                "height",
                "luminance",
                "average_color",
                "updated_at",
            ]
        )
        return {"status": "ready", "variants": list(variants)}


def _mean_luminance(image) -> float:
    """
    Средняя относительная яркость кадра по WCAG 2.1, 0..1.

    Считается по уменьшенной копии: разница со средним по оригиналу — третий
    знак, а времени в сотни раз меньше. Формула та же, что у контраста, — иначе
    витрина подбирала бы затемнение по одной шкале, а проверяла по другой.
    """
    small = image.copy()
    small.thumbnail((64, 64), Image.Resampling.BILINEAR)
    pixels = list(small.getdata())
    if not pixels:
        return 0.5

    def channel(value: int) -> float:
        v = value / 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4

    total = 0.0
    for r, g, b in pixels:
        total += 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    return round(total / len(pixels), 4)


def _average_color(image) -> str:
    """Средний цвет кадра `#rrggbb` — по копии 1×1, тем же приёмом, что яркость."""
    tiny = image.convert("RGB").resize((1, 1), Image.Resampling.BOX)
    r, g, b = tiny.getpixel((0, 0))
    return f"#{r:02x}{g:02x}{b:02x}"


def focus_from_crop(crop: dict | None) -> dict:
    """
    Фокус из старого кадра — центр его рамки (партия 58а). Нет кадра — центр.

    Значения подрезаются по границам тем же правилом, что резала рамка: кадр,
    уехавший за край, — ошибка клиента, а не повод уронить обработку.
    """
    if not crop:
        return {"x": 0.5, "y": 0.5}
    try:
        x = min(max(float(crop.get("x", 0.0)), 0.0), 1.0)
        y = min(max(float(crop.get("y", 0.0)), 0.0), 1.0)
        w = min(max(float(crop.get("w", 1.0)), 0.0), 1.0 - x)
        h = min(max(float(crop.get("h", 1.0)), 0.0), 1.0 - y)
    except (TypeError, ValueError):
        return {"x": 0.5, "y": 0.5}
    return {"x": round(x + w / 2, 4), "y": round(y + h / 2, 4)}


def target_widths(original_width: int, *, backdrop: bool = False) -> list[int]:
    """
    Ряд ширин для оригинала: не шире его; уже самой узкой — одна, своя.

    Оригинал заметно шире последней ширины ряда (1400 при ряде до 1200) —
    последней идёт его собственная ширина: иначе шапке 1080 при DPR 2 доставалось
    1200 из 1400 имеющихся, и 200 точек пропадали зря (замер 17.10).

    `backdrop` — ассет стоит фоном бренда: ряд продолжается до
    `MEDIA_BACKDROP_WIDTH` (партия 58а, дочистка).
    """
    series = tuple(settings.MEDIA_WIDTHS)
    if backdrop:
        series += (settings.MEDIA_BACKDROP_WIDTH,)
    widths = [w for w in series if w <= original_width]
    if not widths:
        return [original_width]
    # Только ЗАЗОР ниже потолка ряда: шире потолка гостю не нужно ни на одном месте.
    if widths[-1] < series[-1] and original_width > widths[-1] * 1.15:
        widths.append(original_width)
    return widths


def is_brand_backdrop(asset: MediaAsset) -> bool:
    """
    Стоит ли ассет фоном бренда своего отеля (токены основной темы,
    `brand.background.imageAssetId`). Звать в контексте отеля ассета.
    """
    from apps.hotels.models import BrandTheme, Hotel

    # Без отеля (заготовка ассета в памяти) фоном бренда быть нечему.
    if not getattr(asset, "hotel_id", None):
        return False
    theme_id = Hotel.all_objects.filter(pk=asset.hotel_id).values_list("default_theme_id", flat=True).first()
    if not theme_id:
        return False
    tokens = BrandTheme.objects.filter(pk=theme_id).values_list("tokens", flat=True).first() or {}
    background = (tokens.get("brand") or {}).get("background") or {}
    return str(background.get("imageAssetId") or "") == str(asset.pk)


def missing_backdrop_width(asset: MediaAsset) -> bool:
    """Фон бренда нарезан обычным рядом — ширины сверх ряда у него ещё нет."""
    if not asset.width:
        return False
    have = {w for w, _ in asset.width_variants()}
    return target_widths(asset.width, backdrop=True)[-1] not in have


def render_variant_bytes(raw: bytes, asset: MediaAsset) -> dict[str, bytes]:
    """
    Оригинал → байты вариантов `{имя: webp}`; заодно ставит ассету размеры,
    яркость и средний цвет. Ничего не пишет — это делает `_render_variants`,
    а `rerender_media --dry-run` по этим байтам считает объём (партия 58а).
    """
    with Image.open(io.BytesIO(raw)) as image:
        # EXIF-поворот: фотографии с телефона иначе лягут боком.
        image = ImageOps.exif_transpose(image)
        # ПРОЗРАЧНОСТЬ СОХРАНЯЕТСЯ (партия 25). Всё шло через `convert("RGB")`,
        # и логотип с прозрачным фоном приезжал к гостю на белом квадрате —
        # на тёмном экране входа и на стеклянной шапке одинаково. WebP держит
        # альфу, так что путь один на всех: есть прозрачность — RGBA, нет
        # (фото) — RGB, как было.
        has_alpha = image.mode in ("RGBA", "LA") or (
            image.mode == "P" and "transparency" in image.info
        )
        image = image.convert("RGBA" if has_alpha else "RGB")
        asset.width, asset.height = image.size
        asset.luminance = _mean_luminance(image.convert("RGB"))
        asset.average_color = _average_color(image)

        # КАДР БОЛЬШЕ НЕ ВЫРЕЗАЕТСЯ (партия 58а). Варианты — целый оригинал в
        # его пропорциях; куда смотреть, место показа берёт из `focus`. Вырезанная
        # рамка подходила одной форме, а фото показывают в десятке: баннер терял
        # на сервере 69% и ещё половину остатка в браузере (замер 17.10).
        sizes: dict[str, int] = {"thumb": settings.MEDIA_THUMB_WIDTH}
        for width in target_widths(image.width, backdrop=is_brand_backdrop(asset)):
            sizes[f"w{width}"] = width

        out: dict[str, bytes] = {}
        for name, width in sizes.items():
            variant = image.copy()
            # Только уменьшение: `thumbnail` не растягивает. Высота не мешает —
            # предел по ней вчетверо выше ширины.
            variant.thumbnail((width, width * 4), Image.Resampling.LANCZOS)
            buffer = io.BytesIO()
            variant.save(buffer, format="WEBP", quality=settings.MEDIA_WEBP_QUALITY, method=4)
            out[name] = buffer.getvalue()
    return out


def _render_variants(raw: bytes, asset: MediaAsset) -> dict[str, str]:
    variants: dict[str, str] = {}
    for name, body in render_variant_bytes(raw, asset).items():
        key = storage.object_key(asset.hotel_id, asset.kind, f"{uuid.uuid4().hex}.webp", variant=name)
        storage.put_bytes(key, body, content_type="image/webp")
        variants[name] = key
    return variants


@shared_task(autoretry_for=(Exception,), retry_backoff=True, max_retries=3)
def purge_media_asset(object_keys: list[str]) -> int:
    for key in object_keys:
        storage.delete_object(key)
    return len(object_keys)


@shared_task(acks_late=True, max_retries=0, ignore_result=True)
def purge_hotel_media(hotel_id: str, object_keys: list[str], asset_count: int) -> dict:
    """
    Удалить объекты отеля из хранилища и ЗАПИСАТЬ ИСХОД В ОТЕЛЬ.

    ФОНОВОЙ ЗАДАЧЕЙ, а не в запросе: у отеля бывают тысячи объектов, и
    офбординг крупного отеля повесил бы HTTP-запрос до таймаута.

    ИСХОД ПИШЕТСЯ В ОТМЕТКУ ОФБОРДИНГА, а не только в лог. «Данные отеля
    удалены» — обещание, которое отель может проверить; основывать его на
    строке в логе, которую никто не читает, нельзя. Пока хранилище не
    отчиталось, отметка держит состояние `pending`, а при отказе — `failed`
    вместе с числом неудалённых объектов, чтобы оператор увидел и повторил.
    """
    from apps.hotels.services.offboarding import record_storage_purge
    from apps.media.services import storage

    result = storage.delete_objects(object_keys)
    outcome = {
        "state": "done" if not result["failed"] else "failed",
        "assets": asset_count,
        "objects": len(object_keys),
        "deleted": len(result["deleted"]),
        "failed": len(result["failed"]),
        # Ключи, которые не ушли, — чтобы повтор не начинался с нуля.
        "failed_keys": result["failed"][:200],
    }
    record_storage_purge(hotel_id, outcome)
    return outcome
