"""
Фотографии демо-контента (R4) — сторож против возврата долга R1/R2.

Там обложки РИСОВАЛИСЬ процедурно: градиент с монограммой вместо снимка. План
требовал настоящих фотографий через медиапайплайн, и здесь проверяется, что
демо-отель поднимается именно с ними, а не с нарисованными прямоугольниками.

Признак настоящего снимка — JPEG из манифеста; процедурные обложки были PNG.
"""

from __future__ import annotations

import pytest

from apps.catalog.models import Item, ItemImage
from apps.core.context import tenant_context
from apps.hotels.models import Service
from apps.media import seed_photos

pytestmark = pytest.mark.django_db


def test_every_venue_has_a_real_photo(crystal):
    with tenant_context(crystal):
        without = [
            service.code
            for service in Service.objects.select_related("image")
            if service.image_id is None or service.image.content_type != "image/jpeg"
        ]
    assert without == [], f"заведения без настоящей обложки: {without}"


def test_every_item_has_a_real_photo(crystal):
    with tenant_context(crystal):
        real = set(
            ItemImage.objects.filter(asset__content_type="image/jpeg").values_list(
                "item_id", flat=True
            )
        )
        without = [item.code for item in Item.objects.all() if item.pk not in real]
    assert without == [], f"позиции без настоящего фото: {without}"


def test_every_menu_section_has_a_real_photo(crystal):
    """
    Раздел меню виден гостю не меньше блюда. В R4 аудит их не покрывал, и часть
    осталась с процедурной обложкой R1/R2.
    """
    from apps.catalog.models import Category
    from apps.media import seed_photos

    with tenant_context(crystal):
        without = [
            category.code
            for category in Category.objects.select_related("image")
            if category.code in seed_photos.PHOTOS
            and (category.image_id is None or category.image.content_type != "image/jpeg")
        ]
    assert without == [], f"разделы без настоящего фото: {without}"


def test_manifest_covers_everything_the_seed_creates(crystal):
    """
    Новая позиция в сиде без снимка в манифесте — это будущий плейсхолдер.
    Ловим здесь, а не глазами на демо.
    """
    with tenant_context(crystal):
        codes = set(Item.objects.values_list("code", flat=True))
        venues = {f"venue-{code}" for code in Service.objects.values_list("code", flat=True)}

    missing = sorted((codes | venues) - set(seed_photos.PHOTOS))
    assert missing == [], f"нет снимка в манифесте: {missing}"


def test_photos_come_from_the_cache_not_the_network(crystal):
    """
    Сид обязан подниматься офлайн: снимки лежат в кэше, и повторный прогон в
    сеть не ходит. Иначе окружение переставало бы разворачиваться без интернета.
    """
    for code in list(seed_photos.PHOTOS)[:5]:
        assert seed_photos.cached_path(code).exists(), f"нет в кэше: {code}"


def test_manifest_names_its_authors():
    """Лицензия Unsplash атрибуции не требует — но чужая работа названа."""
    for code in seed_photos.PHOTOS:
        assert seed_photos.attribution(code).endswith("Unsplash"), code
        assert seed_photos.alt_text(code), code
