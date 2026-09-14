"""
Размер текста и цвет текста: то, что было в модели и не имело органа.

`fontSizeBase`, `headingScale` и `palette.*.text` доезжали до витрины с самого
начала — менялись они только вместе с пресетом, целиком. Теперь их правит
редактор, и значит, у них появились границы: настройка, которую можно задать
рукой, обязана иметь предел, иначе первый же PATCH с кеглем 400 уносит витрину.
"""

from __future__ import annotations

import pytest

from tests.conftest import host_for

pytestmark = pytest.mark.django_db


def _patch(cms, typography: dict):
    return cms.patch("/api/cms/brand", {"tokens": {"typography": typography}})


def _guest_theme(client, hotel) -> dict:
    response = client.post(
        "/api/guest/session",
        data={"room_number": "305"},
        content_type="application/json",
        HTTP_HOST=host_for(hotel),
    )
    return response.json()["hotel"]["theme"]


def test_text_size_reaches_the_guest(client, crystal, cms):
    """Кегль, выбранный в редакторе, приходит гостю — иначе орган фиктивный."""
    assert _patch(cms, {"fontSizeBase": 18}).status_code == 200

    theme = _guest_theme(client, crystal)
    assert theme["typography"]["fontSizeBase"] == 18


def test_heading_scale_reaches_the_guest(client, crystal, cms):
    assert _patch(cms, {"headingScale": 1.25}).status_code == 200

    theme = _guest_theme(client, crystal)
    assert theme["typography"]["headingScale"] == 1.25


@pytest.mark.parametrize("size", [8, 13, 21, 400])
def test_unreadable_or_broken_text_size_is_refused(cms, size):
    """
    Границы — не вкусовщина.

    Ниже 14 витрину не прочитает гость, ради которого она и сделана; выше 20
    цены и кнопки перестают помещаться в строку, и карточка начинает врать про
    то, что в ней есть.
    """
    response = _patch(cms, {"fontSizeBase": size})
    assert response.status_code == 422, response.content
    assert "fontSizeBase" in response.content.decode()


@pytest.mark.parametrize("scale", [0.5, 0.84, 1.41, 3])
def test_heading_scale_out_of_range_is_refused(cms, scale):
    response = _patch(cms, {"headingScale": scale})
    assert response.status_code == 422, response.content


def test_text_size_must_be_a_number(cms):
    """Строка «18» проходит как число только у того, кто её не проверял."""
    response = _patch(cms, {"fontSizeBase": "18"})
    assert response.status_code == 422, response.content


def test_text_colour_reaches_the_guest(client, crystal, cms):
    """Цвет текста правится отдельно от пресета и доезжает до витрины."""
    saved = cms.patch(
        "/api/cms/brand",
        {"tokens": {"palette": {"light": {"text": "#301010"}}}},
    )
    assert saved.status_code == 200, saved.content

    theme = _guest_theme(client, crystal)
    assert theme["palette"]["light"]["text"].lower() == "#301010"


def test_unreadable_text_colour_is_allowed_but_stays_exactly_as_chosen(client, crystal, cms):
    """
    Нечитаемый цвет СОХРАНЯЕТСЯ, и это осознанно.

    Запрет здесь был бы хуже предупреждения: отель вправе выбрать бледный текст
    на своей странице-заставке, и подменять его молча нельзя — это наш класс
    дефектов. Про контраст говорит редактор словами; сервер обязан сохранить
    ровно то, что выбрали, а не «поправленное».
    """
    surface = _guest_theme(client, crystal)["palette"]["light"]["surface"]

    assert cms.patch(
        "/api/cms/brand", {"tokens": {"palette": {"light": {"text": surface}}}}
    ).status_code == 200

    theme = _guest_theme(client, crystal)
    assert theme["palette"]["light"]["text"].lower() == surface.lower()
