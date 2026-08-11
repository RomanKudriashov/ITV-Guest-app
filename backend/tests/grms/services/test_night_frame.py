"""
Ночной кадр плана: гашение самих источников и его предохранители.

Проверяется ПРАВИЛО, а не картинка. Кадры собираются здесь же из прямоугольников:
тест, привязанный к конкретному рендеру, краснел бы при замене демо-ассета и
ничего не говорил бы про чужой снимок, ради которого предохранители и заведены.
"""

from __future__ import annotations


import pytest
from PIL import Image, ImageChops, ImageDraw, ImageStat

from tests.helpers import REPO_ROOT

from apps.grms.services import nightframe


def _frame(background: int, spots: list[tuple[int, int, int, int]] | None = None) -> Image.Image:
    """Кадр заданной яркости с тёплыми яркими пятнами (источниками)."""
    image = Image.new("RGB", (400, 300), (background, background, background))
    draw = ImageDraw.Draw(image)
    for box in spots or []:
        draw.rectangle(box, fill=(255, 235, 190))  # тёплый и яркий — лампа
    return image


def _difference(left: Image.Image, right: Image.Image) -> float:
    return ImageStat.Stat(ImageChops.difference(left.convert("L"), right.convert("L"))).sum[0]


def test_dark_frame_with_small_warm_spot_is_extinguished():
    """Тёмный кадр с маленькой тёплой лампой — то, ради чего проход и написан."""
    source = _frame(30, [(180, 130, 220, 170)])

    assert nightframe.emitters_are_plausible(source)

    lit = source.convert("L").point(lambda value: 255 if value > 200 else 0)
    with_pass = nightframe.bake(source)
    without_pass = nightframe.bake(source, extinguish_sources=False)

    assert (
        ImageStat.Stat(with_pass.convert("L"), lit).mean[0]
        < ImageStat.Stat(without_pass.convert("L"), lit).mean[0]
    ), "лампа осталась такой же яркой — проход не сработал"


def test_bright_frame_is_left_alone():
    """
    Дневной светлый снимок проход НЕ трогает.

    Порог «ярче окружения» на светлом интерьере ловит простыню и плитку, а не
    лампу. Отказ в сторону «ничего не делаем»: горящая лампа на кадре хуже, чем
    её отсутствие, но испорченный кадр администратор починить не сможет.
    """
    source = _frame(210, [(180, 130, 220, 170)])

    assert not nightframe.emitters_are_plausible(source)
    assert _difference(nightframe.bake(source), nightframe.bake(source, extinguish_sources=False)) == 0


def test_frame_covered_in_warm_bright_areas_is_left_alone():
    """Маска взяла половину кадра — значит нашла не лампы, а мебель."""
    source = _frame(30, [(0, 0, 400, 160)])

    assert not nightframe.emitters_are_plausible(source)
    assert _difference(nightframe.bake(source), nightframe.bake(source, extinguish_sources=False)) == 0


def test_geometry_never_changes():
    """Размер кадра не меняется ни на пиксель — иначе кадры перестанут совмещаться."""
    source = _frame(30, [(180, 130, 220, 170)])
    assert nightframe.bake(source).size == source.size


DEMO_RENDER = (
    REPO_ROOT / "docs" / "design" / "grms-concept" / "render-type1-cropped.png"
)


@pytest.mark.skipif(not DEMO_RENDER.exists(), reason="демо-рендер недоступен в этой сборке")
def test_demo_render_passes_the_guards():
    """
    Живой демо-рендер проходит предохранители, а его лампы гаснут.

    Единственный тест, привязанный к файлу: он отвечает на вопрос «работает ли
    правило на том классе кадров, ради которого написано».
    """
    with Image.open(DEMO_RENDER) as source:
        source = source.convert("RGB")

        assert nightframe.emitters_are_plausible(source)

        lit = source.convert("L").point(lambda value: 255 if value > 200 else 0)
        with_pass = ImageStat.Stat(nightframe.bake(source).convert("L"), lit).mean[0]
        without_pass = ImageStat.Stat(
            nightframe.bake(source, extinguish_sources=False).convert("L"), lit
        ).mean[0]

    assert with_pass < without_pass


def test_extinguish_flag_travels_from_the_plan_to_the_bake():
    """
    Переключатель администратора доходит до расчёта.

    Флаг живёт в конфигурации плана, а не в коде: порог «ярче окружения» на
    светлом рендере не срабатывает, и решить, гасить ли лампы, может только
    тот, кто видит свой кадр. Здесь проверяется сама передача — что настройка
    не теряется по дороге от формы до пикселей.
    """
    import io

    source = _frame(30, [(180, 130, 220, 170)])
    buffer = io.BytesIO()
    source.save(buffer, format="PNG")
    raw = buffer.getvalue()

    with_pass, size_on = nightframe.bake_bytes(raw, extinguish_sources=True)
    without_pass, size_off = nightframe.bake_bytes(raw, extinguish_sources=False)

    assert with_pass != without_pass, "флаг не доехал до расчёта"
    # Геометрия не зависит от флага ни в одном из положений: кадры обязаны
    # совмещаться со светлым, иначе план поедет.
    assert size_on == size_off == source.size
