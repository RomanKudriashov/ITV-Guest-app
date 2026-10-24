"""
Прозрачный кадр плана → светлый фон, не чёрный (партия 64-1).

Планировки с сайта «Сиалии» — PNG с прозрачным полем; под альфой у них
(0, 0, 0). Без правки при переводе в RGB план ложился на чёрное поле.
"""

import io

from PIL import Image

from apps.grms.services.plan_editor import OPAQUE_BACKGROUND, _opaque


def _png(image: Image.Image) -> bytes:
    out = io.BytesIO()
    image.save(out, "PNG")
    return out.getvalue()


def test_bite_transparent_frame_gets_light_background():
    image = Image.new("RGBA", (40, 40), (0, 0, 0, 0))  # прозрачно, под альфой — чёрный
    image.paste((120, 90, 60, 255), (10, 10, 30, 30))  # «план» в середине
    flat = Image.open(io.BytesIO(_opaque(_png(image))))
    assert flat.mode == "RGB"
    assert flat.getpixel((1, 1)) == OPAQUE_BACKGROUND, "прозрачное поле стало не светлым"
    assert flat.getpixel((20, 20)) == (120, 90, 60), "сам план изменился"


def test_opaque_frame_is_left_byte_for_byte():
    raw = _png(Image.new("RGB", (20, 20), (10, 20, 30)))
    assert _opaque(raw) is raw
    solid_alpha = _png(Image.new("RGBA", (20, 20), (10, 20, 30, 255)))
    assert _opaque(solid_alpha) is solid_alpha, "непрозрачный RGBA перекодирован зря"
