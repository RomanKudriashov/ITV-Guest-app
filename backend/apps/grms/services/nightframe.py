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

  5. САМИ ИСТОЧНИКИ ГАСЯТСЯ ОТДЕЛЬНО. Шаги 1–4 снимают то, что лампа осветила,
     но не саму лампу: её пиксели ярки собственным свечением, и после деления
     материал читается как белый. Яркие тёплые области заменяются размытым
     окружением ночного кадра.

ГЕОМЕТРИЯ НЕ ТРОГАЕТСЯ ВОВСЕ — это те же пиксели, к которым применена цветовая
функция. Именно поэтому посчитанный кадр совмещён со светлым по построению, а
пара снятых отдельно кадров совмещённой быть не обязана (см. `pair.py`).
"""

from __future__ import annotations

import io

from PIL import Image, ImageChops, ImageFilter, ImageStat

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

# --- Гашение самих источников (шаг 5) ---------------------------------------
#
# Деление на освещённость (шаг 1) убирает РАЗЛИВ света: пятно под лампой, тени,
# перепад «под спотом ярче». Выключить саму лампу оно не может — её пиксели
# ярки собственным свечением, а не отражённым, и после деления материал
# читается как белый. На ночном кадре светильники и светодиодная лента
# оставались горящими.
#
# ПРИЗНАК — «ЯРЧЕ СВОЕГО ОКРУЖЕНИЯ», А НЕ «ЯРЧЕ ПОРОГА». Порог из скрипта
# (яркость > 0.62 при теплоте > 0.06, плюс всё ярче 0.85) подобран на нашем
# рендере и на чужих кадрах берёт не лампы, а всё светлое. Замерено на четырёх
# посторонних снимках из медиатеки стенда:
#
#     кадр                     по порогу   по окружению
#     наш рендер                    8.1%           4.5%
#     отель у бассейна             44.5%           9.7%
#     интерьер                     16.7%           1.1%
#     рум-сервис                   32.2%           6.5%
#     уборка                       32.9%           0.7%
#
# Лампа ярче того, что вокруг неё; простыня, плитка и небо — ровные светлые
# пятна, и локального превышения у них нет.
EMITTER_POP = 38  # насколько ярче размытого окружения
EMITTER_WARM = 15  # 0.06: превышение красного над синим
EMITTER_AROUND = 0.020  # радиус «окружения», в долях ширины
EMITTER_GROW = 0.009
EMITTER_BLUR = 0.006
EMITTER_AROUND_BLUR = 0.027
# Насколько ярким остаётся место лампы. Не ноль: чёрная дыра на месте
# светильника читается как дефект кадра, а не как выключенный свет.
EMITTER_MIX = 0.75

# ДВА ПРЕДОХРАНИТЕЛЯ, и оба отказывают в сторону «ничего не делать».
#
# Проход осмыслен ровно на одном классе кадров: тёмный ночной рендер, где
# лампа — маленькое яркое пятно на тёмном фоне. На дневном снимке светлого
# интерьера то же правило начинает есть картинку.
#
# Медиана яркости: наш рендер 38, посторонние снимки 88–197.
EMITTER_MAX_MEDIAN = 55
# Доля кадра под маской: больше — значит нашли не лампы.
EMITTER_MAX_COVERAGE = 0.06


def _channel_curve(gain: float, floor: float) -> list[int]:
    """LUT канала: сжатие альбедо, подложка, гамма, яркость."""
    curve = []
    for value in range(256):
        toned = ALBEDO_PIVOT + (value - ALBEDO_PIVOT) * ALBEDO_CONTRAST
        toned = max(0.0, min(255.0, toned)) / 255
        curve.append(max(0, min(255, round(255 * (floor + (1 - floor) * toned**GAMMA * gain)))))
    return curve


def emitter_core(image: Image.Image) -> Image.Image:
    """
    ЯДРО маски: сами пиксели, похожие на источник — тёплые и ярче окружения.

    Отдельно от расширенной маски, потому что доля кадра считается ИМЕННО ПО
    ЯДРУ. Расширение и растушёвка нужны, чтобы гашение не оставляло ореол, но
    они же раздувают площадь втрое — мерить по ним значит мерить свой же
    радиус размытия, а не снимок.
    """
    grey = image.convert("L")
    around = grey.filter(ImageFilter.GaussianBlur(image.width * EMITTER_AROUND))
    pop = ImageChops.subtract(grey, around)

    red, _green, blue = image.split()
    warm = ImageChops.subtract(red, blue)

    stands_out = pop.point(lambda value: 255 if value > EMITTER_POP else 0)
    warm_enough = warm.point(lambda value: 255 if value > EMITTER_WARM else 0)
    return ImageChops.multiply(stands_out, warm_enough)


def emitter_mask(image: Image.Image) -> Image.Image:
    """Ядро, расширенное и растушёванное — по нему и гасим."""
    grow = max(3, int(round(image.width * EMITTER_GROW)) | 1)
    mask = emitter_core(image).filter(ImageFilter.MaxFilter(grow))
    return mask.filter(ImageFilter.GaussianBlur(image.width * EMITTER_BLUR))


def _median_lightness(image: Image.Image) -> int:
    histogram = image.convert("L").histogram()
    half = sum(histogram) / 2
    running = 0
    for value, count in enumerate(histogram):
        running += count
        if running >= half:
            return value
    return 255


def emitters_are_plausible(image: Image.Image) -> bool:
    """
    Похоже ли, что маска нашла ИСТОЧНИКИ, а не светлые поверхности.

    Проверяются две вещи: кадр тёмный (иначе это не ночной рендер) и маска
    занимает малую долю (иначе под неё попала мебель). Обе — отказ в сторону
    «ничего не делаем»: горящая лампа на кадре хуже, чем съеденная простыня,
    но ненамного, а вот съеденный кадр админ починить не сможет.
    """
    if _median_lightness(image) > EMITTER_MAX_MEDIAN:
        return False
    coverage = ImageStat.Stat(emitter_core(image)).mean[0] / 255
    return coverage <= EMITTER_MAX_COVERAGE


def extinguish(night: Image.Image, mask: Image.Image) -> Image.Image:
    """Подменить источники размытым окружением ночного кадра."""
    around = night.filter(ImageFilter.GaussianBlur(night.width * EMITTER_AROUND_BLUR))
    around = around.point(lambda value: round(value * EMITTER_MIX))
    return Image.composite(around, night, mask)


def bake(source: Image.Image, *, extinguish_sources: bool = True) -> Image.Image:
    """
    Светлый кадр → ночной. Размер и геометрия не меняются ни на пиксель.

    `extinguish_sources=False` оставляет светильники горящими. Флаг нужен,
    чтобы сравнить кадр с проходом и без него на чужом снимке: если пороги
    съедают светлые поверхности, это видно только сравнением.
    """
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

    night = Image.merge("RGB", (red, green, blue))

    if not extinguish_sources:
        return night

    # 5. Гашение источников — по маске, снятой со СВЕТЛОГО кадра: на ночном
    # лампы уже перекрашены, и искать их там поздно. Если маска не похожа на
    # источники, кадр остаётся как был: лучше горящая лампа, чем испорченный
    # кадр, который администратор не сможет починить.
    if not emitters_are_plausible(image):
        return night
    return extinguish(night, emitter_mask(image))


def bake_bytes(raw: bytes, *, extinguish_sources: bool = True) -> tuple[bytes, tuple[int, int]]:
    """Байты светлого кадра → байты ночного (PNG) и размер кадра."""
    with Image.open(io.BytesIO(raw)) as source:
        size = source.size
        result = bake(source, extinguish_sources=extinguish_sources)
    if result.size != size:
        raise ValueError("размер кадра изменился — кадры перестанут совмещаться")

    buffer = io.BytesIO()
    result.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue(), size
