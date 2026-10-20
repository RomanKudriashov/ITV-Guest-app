"""
Адрес медиа — от хоста страницы (партия 61).

Витрина на naviroom.navicentric.ru качала картинки с app.<ip>.sslip.io:
отдельное соединение и 0,4–0,5 с на запрос. Медиа отдаёт наш же nginx на любом
домене приложения, поэтому, если публичный адрес медиа — наш домен, картинка
отдаётся путём без хоста.
"""

from __future__ import annotations

import pytest
from django.test import override_settings

from apps.media.models import MediaAsset
from config.domains import media_on_own_domain


def test_own_domain_rule():
    bases = ["naviroom.navicentric.ru", "app.147.45.245.172.sslip.io"]
    assert media_on_own_domain("app.147.45.245.172.sslip.io", bases)
    assert media_on_own_domain("APP.147.45.245.172.sslip.io:443", bases)
    assert not media_on_own_domain("localhost:9000", bases)
    assert not media_on_own_domain("cdn.example.com", bases)
    assert not media_on_own_domain("", bases)


@pytest.mark.parametrize(
    ("relative", "expected"),
    [
        (True, "/guest-media/hotels/h/item/w400/a.webp"),
        (False, "https://media.example/guest-media/hotels/h/item/w400/a.webp"),
    ],
)
def test_asset_url_follows_the_rule(relative, expected):
    asset = MediaAsset(object_key="hotels/h/item/original/a.png", variants={"w400": "hotels/h/item/w400/a.webp"})
    with override_settings(
        MEDIA_RELATIVE_URLS=relative,
        MINIO_PUBLIC_ENDPOINT="media.example",
        MINIO_BUCKET="guest-media",
        GUEST_APP_PUBLIC_SCHEME="https",
    ):
        assert asset.key_url("hotels/h/item/w400/a.webp") == expected
        assert asset.original_url().endswith("/guest-media/hotels/h/item/original/a.png")
        assert asset.original_url().startswith("/" if relative else "https://media.example/")
