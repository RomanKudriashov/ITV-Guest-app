#!/usr/bin/env python3
"""
Печёт кадр «свет выключен» ИЗ светлого рендера — попиксельно совмещённый с ним.

Зачем: два отдельно сгенерированных рендера (со светом и без) не совмещаются —
на реальных кадрах габариты комнаты разошлись примерно на 21%, мебель двоится.
Кадр, посчитанный из светлого, совпадает с ним всегда и по построению.

Как это работает: сильное размытие яркости даёт оценку запечённого в кадр света;
деление на неё оставляет материал (альбедо) почти без световых пятен. Дальше
материал заново «освещается» плоским холодным светом — получается ночная комната,
а не затонированная дневная.

    pip install pillow numpy --break-system-packages -q
    python3 bake_dark_plate.py render-type1.png render-type1-off.png

Параметры подгоняются под конкретный рендер:
    --exposure   общая яркость ночного кадра (по умолчанию 0.30)
    --desat      обесцвечивание, 0..1 (0.80)
    --tint       холодный тон, три числа (0.55 0.66 0.95)
    --sigma      радиус оценки света в пикселях (70)
"""
import argparse
import numpy as np
from PIL import Image, ImageFilter

LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)

ap = argparse.ArgumentParser()
ap.add_argument("src")
ap.add_argument("dst")
ap.add_argument("--exposure", type=float, default=0.30)
ap.add_argument("--desat", type=float, default=0.80)
ap.add_argument("--tint", type=float, nargs=3, default=[0.55, 0.66, 0.95])
ap.add_argument("--sigma", type=float, default=70)
ap.add_argument("--no-extinguish", action="store_true",
                help="не гасить сами светильники (по умолчанию гасим)")
a = ap.parse_args()

img = Image.open(a.src).convert("RGB")
rgb = np.array(img).astype(np.float32) / 255.0
lum = rgb @ LUMA

# оценка запечённого света
blur = Image.fromarray((np.clip(lum, 0, 1) * 255).astype("uint8")).filter(
    ImageFilter.GaussianBlur(a.sigma)
)
light = np.array(blur).astype(np.float32) / 255.0

# материал без световых пятен
albedo = np.clip(rgb / (light[..., None] + 0.10), 0, 1.6)

# ночь: обесцветить и заново осветить плоским холодным светом
gray = np.repeat((albedo @ LUMA)[..., None], 3, axis=2)
out = (gray * a.desat + albedo * (1 - a.desat)) * np.array(a.tint, np.float32) * a.exposure

# Гасим САМИ ИСТОЧНИКИ. Деление на освещённость убирает разлив света, но не может
# выключить лампу: её пиксели ярки собственным свечением, и материал читается как белый.
# Поэтому светильники и светодиодные ленты остаются «включёнными» на ночном кадре.
# Находим яркие тёплые области и заменяем их размытым окружением ночного кадра.
if not a.no_extinguish:
    warm = rgb[:, :, 0] - rgb[:, :, 2]
    emitters = ((lum > 0.62) & (warm > 0.06)) | (lum > 0.85)
    mask = Image.fromarray((emitters * 255).astype("uint8"))
    mask = mask.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(6))
    alpha = (np.array(mask).astype(np.float32) / 255.0)[..., None]
    around = Image.fromarray((np.clip(out, 0, 1) * 255).astype("uint8"))
    around = np.array(around.filter(ImageFilter.GaussianBlur(28))).astype(np.float32) / 255.0
    out = out * (1 - alpha) + around * 0.75 * alpha

Image.fromarray((np.clip(out, 0, 1) * 255).astype("uint8")).save(a.dst)
print(f"готово: {a.dst} ({img.size[0]}×{img.size[1]}, совмещён с {a.src} попиксельно)")
