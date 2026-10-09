"""
ВИДИМОЕ ИМЯ ПРОДУКТА НА СТОРОНЕ СЕРВЕРА — NaviRoom (партия 50).

Издатель в приложении-аутентификаторе и заголовок документации API — то, что
человек видит, не открывая нашего интерфейса. ITV во внутренних именах
(`urls_namespace`, база, роли) не трогаем — `docs/decisions.md`.
"""

from __future__ import annotations

from apps.accounts.services.totp import provisioning_uri


def test_the_authenticator_shows_naviroom():
    """УКУС. В приложении-аутентификаторе учётка подписана «NaviRoom»."""
    uri = provisioning_uri("JBSWY3DPEHPK3PXP", account="owner@crystal.local")
    assert uri.startswith("otpauth://totp/NaviRoom%3Aowner%40crystal.local?")
    assert "&issuer=NaviRoom&" in uri


def test_the_api_docs_are_titled_naviroom():
    """УКУС. Документация API называется «NaviRoom API»."""
    from api import api

    assert api.title == "NaviRoom API"
