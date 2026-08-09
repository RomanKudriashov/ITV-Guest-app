"""
Ночной кадр плана — считается НА СЕРВЕРЕ из светлого.

Раньше это был скрипт в docs/design/grms-concept/bake_dark_plate.py. Для
разработчика это нормально, для администратора отеля — нет: он не запустит
питон, чтобы завести номер, и остался бы либо без ночного кадра, либо с парой
кадров, снятых как попало. Поэтому расчёт переехал в фоновую задачу и живёт
рядом с нарезкой вариантов медиа.

Функция ровно та же, что в скрипте, и здесь её описание по шагам:

  1. ДЕЛЕНИЕ НА ОСВЕЩЁННОСТЬ. В светлом рендере светлое — это освещённое:
     пятна под светильниками, белая плитка ванной под спотами, покрывало под
     лампой. «Выключить свет» значит снять именно освещённость, оставив
     собственный цвет поверхностей: кадр делится на размытую светлоту.

     Почему делением, а не затемнением: затемнение множит всё на одно число,
     пятно под лампой остаётся ярче стены во столько же раз, и ванная остаётся
     светлым пятном, читаемым как «там горит свет».

  2. ТЁПЛОЕ ГАСИТСЯ ДОПОЛНИТЕЛЬНО: деление снимает силу лампы, но оставляет её
     тёплый оттенок на стене, а тёплая полутьма читается как «свет притушили».

  3. АЛЬБЕДО ПОДЖИМАЕТСЯ К ОБЩЕМУ УРОВНЮ: без этого белая плитка остаётся
     заметно светлее комнаты, и глаз читает перепад как источник света.

  4. ОСТАТОК УВОДИТСЯ В ХОЛОД: ночью глаз видит синее (эффект Пуркинье).

ГЕОМЕТРИЯ НЕ ТРОГАЕТСЯ ВОВСЕ — это те же пиксели, к которым применена цветовая
функция. Именно поэтому посчитанный кадр совмещён со светлым по построению, а
пара снятых отдельно кадров совмещённой быть не обязана (см. `pair.py`).
"""

from __future__ import annotations

import io

from PIL import Image, ImageChops, ImageFilter

# Радиус размытия карты освещённости, в долях ширины кадра.
LIGHT_BLUR = 0.010
# Опорная освещённость деления и добавка в знаменатель: она не даёт делению
# взорваться в тенях, где света и так нет.
LIGHT_PIVOT = 118
LIGHT_FLOOR = 26

# Насколько гасится тёплый оттенок, оставшийся после деления.
WARM_DAMP = 0.42
WARM_GAIN = 1.7
WARM_BLUR = 0.006

# Сжатие альбедо к общему уровню: 1.0 — оставить как есть, 0 — залить одним
# тоном. Опорный уровень примерно соответствует стене номера.
ALBEDO_CONTRAST = 0.46
ALBEDO_PIVOT = 104

# Гамма >1 давит полутона: ночью видно контуры, а не фактуру.
GAMMA = 1.2
# Остатки света по каналам. Синий выше остальных — холодная полутьма.
GAIN = {"R": 0.27, "G": 0.31, "B": 0.43}
# Подложка: не даём кадру стать чёрным прямоугольником.
FLOOR = {"R": 0.012, "G": 0.016, "B": 0.026}


def _channel_curve(gain: float, floor: float) -> list[int]:
    """LUT канала: сжатие альбедо, подложка, гамма, яркость."""
    curve = []
    for value in range(256):
        toned = ALBEDO_PIVOT + (value - ALBEDO_PIVOT) * ALBEDO_CONTRAST
        toned = max(0.0, min(255.0, toned)) / 255
        curve.append(max(0, min(255, round(255 * (floor + (1 - floor) * toned**GAMMA * gain)))))
    return curve


def bake(source: Image.Image) -> Image.Image:
    """Светлый кадр → ночной. Размер и геометрия не меняются ни на пиксель."""
    image = source.convert("RGB")
    red, green, blue = image.split()

    # 1. Деление на освещённость. Делителя у Pillow нет, поэтому обратная
    # величина считается таблицей и применяется умножением: multiply(a, b) это
    # a*b/255, а значит multiply(кадр, 255*pivot/L) даёт кадр*pivot/L.
    lightness = image.convert("L").filter(ImageFilter.GaussianBlur(image.width * LIGHT_BLUR))
    inverse = lightness.point(
        lambda value: min(255, round(255 * LIGHT_PIVOT / (value + LIGHT_FLOOR)))
    )
    red, green, blue = (ImageChops.multiply(band, inverse) for band in (red, green, blue))

    # 2. Карта «теплоты»: превышение красного над синим, размытое до пятен.
    warmth = ImageChops.subtract(red, blue)
    warmth = warmth.point(lambda value: min(255, round(value * WARM_GAIN)))
    warmth = warmth.filter(ImageFilter.GaussianBlur(image.width * WARM_BLUR))
    damp = warmth.point(lambda value: 255 - round(value * WARM_DAMP))
    red, green, blue = (ImageChops.multiply(band, damp) for band in (red, green, blue))

    # 3–4. Сжатие альбедо, яркость и холод — по каналам.
    red = red.point(_channel_curve(GAIN["R"], FLOOR["R"]))
    green = green.point(_channel_curve(GAIN["G"], FLOOR["G"]))
    blue = blue.point(_channel_curve(GAIN["B"], FLOOR["B"]))

    return Image.merge("RGB", (red, green, blue))


def bake_bytes(raw: bytes) -> tuple[bytes, tuple[int, int]]:
    """Байты светлого кадра → байты ночного (PNG) и размер кадра."""
    with Image.open(io.BytesIO(raw)) as source:
        size = source.size
        result = bake(source)
    if result.size != size:
        raise ValueError("размер кадра изменился — кадры перестанут совмещаться")

    buffer = io.BytesIO()
    result.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue(), size
