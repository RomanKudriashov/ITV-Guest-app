"""
ВИДИМОЕ ИМЯ ПРОДУКТА НА СТОРОНЕ СЕРВЕРА — NaviRoom (партия 50), консоли — NaviRoom Control (партия 53).

Издатель в приложении-аутентификаторе и заголовок документации API — то, что
человек видит, не открывая нашего интерфейса. ITV во внутренних именах
(`urls_namespace`, база, роли) не трогаем — `docs/decisions.md`.
"""

from __future__ import annotations

from apps.accounts.services.totp import provisioning_uri


def test_the_authenticator_shows_naviroom_control():
    """
    УКУС. В приложении-аутентификаторе учётка подписана именем консоли —
    «NaviRoom Control» (партия 53): второй фактор есть только у неё.
    """
    uri = provisioning_uri("JBSWY3DPEHPK3PXP", account="owner@crystal.local")
    assert uri.startswith("otpauth://totp/NaviRoom%20Control%3Aowner%40crystal.local?")
    assert "&issuer=NaviRoom%20Control&" in uri


def test_the_api_docs_are_titled_naviroom():
    """УКУС. Документация API называется «NaviRoom API»."""
    from api import api

    assert api.title == "NaviRoom API"
