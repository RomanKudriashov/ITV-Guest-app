"""Заведение и правка баннеров. Вьюха к базе не ходит."""

from __future__ import annotations

from datetime import date, time

from apps.core.errors import NotFoundError, ValidationError
from apps.hotels.models import RoomCategory, Service
from apps.media.models import MediaAsset

from apps.promo.models import Banner, BannerImage, BannerRoomCategory
from apps.promo.services.serializers import cms_payload, stats_for

MAX_IMAGES = 10


def _as_map(value, field: str):
    """Переводимое поле — карта языков. Строка сюда не кладётся."""
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValidationError("Ожидается карта переводов", field=field, code="bad_translation")
    return {str(k): str(v) for k, v in value.items() if str(v).strip()}


def _as_date(value, field: str):
    if value in (None, ""):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValidationError("Дата в формате ГГГГ-ММ-ДД", field=field, code="bad_date") from exc


def _as_time(value, field: str):
    if value in (None, ""):
        return None
    try:
        hours, minutes = str(value).split(":")[:2]
        return time(int(hours), int(minutes))
    except (ValueError, TypeError) as exc:
        raise ValidationError("Время в формате ЧЧ:ММ", field=field, code="bad_time") from exc


def _check_action(banner: Banner) -> None:
    """
    Действие без адреса — баннер, который никуда не ведёт. Гость нажмёт и
    ничего не произойдёт; отель узнает об этом по нулевым переходам, а не по
    сообщению.
    """
    if banner.action == Banner.Action.LINK and not banner.action_url:
        raise ValidationError("Укажите ссылку", field="action_url", code="action_without_target")
    if banner.action == Banner.Action.VENUE and not banner.action_service_id:
        raise ValidationError(
            "Выберите заведение", field="action_service_id", code="action_without_target"
        )
    if banner.action == Banner.Action.PAGE and not (banner.page_body or banner.page_title):
        raise ValidationError(
            "Заполните страницу с описанием", field="page_body", code="action_without_target"
        )


def _apply(banner: Banner, data: dict) -> list[str]:
    fields: list[str] = []
    simple = (
        "name", "size", "placement", "action", "action_url",
        "is_active", "first_visit_only", "priority",
    )
    for key in simple:
        if key in data and data[key] is not None:
            setattr(banner, key, data[key])
            fields.append(key)
    for key in ("title", "subtitle", "page_title", "page_body"):
        if key in data and data[key] is not None:
            setattr(banner, key, _as_map(data[key], key))
            fields.append(key)
    for key in ("starts_on", "ends_on"):
        if key in data:
            setattr(banner, key, _as_date(data[key], key))
            fields.append(key)
    for key in ("time_from", "time_to"):
        if key in data:
            setattr(banner, key, _as_time(data[key], key))
            fields.append(key)
    if "languages" in data and data["languages"] is not None:
        banner.languages = [str(code) for code in data["languages"] if str(code).strip()]
        fields.append("languages")
    if "action_service_id" in data:
        value = data["action_service_id"]
        if value:
            service = Service.objects.filter(pk=value).first()
            if service is None:
                raise ValidationError(
                    "Заведение не найдено", field="action_service_id", code="service_not_found"
                )
            banner.action_service = service
        else:
            banner.action_service = None
        fields.append("action_service")
    return fields


def _set_categories(banner: Banner, ids) -> None:
    """
    Категории — через свою связку, чтобы у строки был отель и её защищала RLS.
    Чужую категорию не примем: иначе баннер одного отеля сослался бы на
    справочник другого, и правило показа молча перестало бы срабатывать.
    """
    wanted = [str(pk) for pk in (ids or [])]
    known = {str(pk) for pk in RoomCategory.objects.filter(pk__in=wanted).values_list("pk", flat=True)}
    missing = [pk for pk in wanted if pk not in known]
    if missing:
        raise ValidationError(
            "Категория номера не найдена", field="room_category_ids", code="category_not_found"
        )
    BannerRoomCategory.objects.filter(banner=banner).delete()
    for pk in wanted:
        BannerRoomCategory.objects.create(
            hotel_id=banner.hotel_id, banner=banner, room_category_id=pk
        )


def list_banners() -> list[dict]:
    rows = list(Banner.objects.prefetch_related("images__asset", "room_categories"))
    stats = stats_for([row.pk for row in rows])
    return [cms_payload(row, stats=stats) for row in rows]


def get_banner(banner_id) -> Banner:
    banner = Banner.objects.filter(pk=banner_id).first()
    if banner is None:
        raise NotFoundError("Баннер не найден")
    return banner


def banner_payload(banner: Banner) -> dict:
    return cms_payload(banner, stats=stats_for([banner.pk]))


def create_banner(data: dict) -> Banner:
    banner = Banner()
    fields = _apply(banner, data)
    if not banner.name:
        raise ValidationError("Укажите название", field="name", code="name_required")
    _check_action(banner)
    banner.save()
    _set_categories(banner, data.get("room_category_ids"))
    del fields
    return banner


def update_banner(banner_id, data: dict) -> Banner:
    banner = get_banner(banner_id)
    fields = _apply(banner, data)
    _check_action(banner)
    if fields:
        banner.save(update_fields=[*fields, "updated_at"])
    if "room_category_ids" in data and data["room_category_ids"] is not None:
        _set_categories(banner, data["room_category_ids"])
    return banner


def delete_banner(banner_id) -> None:
    get_banner(banner_id).delete()


def add_image(banner_id, data: dict) -> Banner:
    banner = get_banner(banner_id)
    if banner.images.count() >= MAX_IMAGES:
        raise ValidationError(
            f"Не больше {MAX_IMAGES} кадров в карусели",
            field="images",
            code="too_many_images",
        )
    asset = MediaAsset.objects.filter(pk=data["asset_id"]).first()
    if asset is None:
        raise ValidationError("Изображение не найдено", field="asset_id", code="asset_not_found")
    BannerImage.objects.create(
        hotel_id=banner.hotel_id,
        banner=banner,
        asset=asset,
        sort_order=data.get("sort_order") or banner.images.count(),
    )
    return banner


def remove_image(banner_id, image_id) -> Banner:
    banner = get_banner(banner_id)
    BannerImage.objects.filter(banner=banner, pk=image_id).delete()
    return banner
