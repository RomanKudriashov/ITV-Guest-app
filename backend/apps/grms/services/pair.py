"""
Проверка ПАРЫ кадров плана: светлый и ночной сняты с одной точки?

Зачем это вообще. Плита гостя — два слоя: ночной кадр виден всегда, светлый
показывается окном по включённой зоне. Совмещение здесь не пожелание, а условие
работы: разойдись кадры на несколько пикселей, и на границе зоны появится
двойная мебель, а разойдись сильнее — гость увидит, что при включении света
комната «прыгает».

Мы на этом уже обожглись. Первая пара рендеров того же номера разошлась по
габаритам примерно на 21% (светлый x 310–1260, тёмный x 217–1365 при одинаковом
кадре 1586×992). Именно поэтому ночной кадр теперь СЧИТАЕТСЯ из светлого — он
совмещён по построению. Но администратор может принести свою пару фотографий, и
её нужно проверить, а не принять молча: молча принятая пара — это дефект,
который увидят только на объекте, когда номер уже сдан.

Как проверяем, по возрастанию строгости:

  1. РАЗМЕР. Разные размеры кадра — сразу отказ: подгонять масштабом мы не
     станем, это и есть та подгонка, от которой мебель двоится.

  2. СХОДИМОСТЬ ПО СОДЕРЖИМОМУ. Считаем карту краёв (границы стен и мебели —
     единственное, что переживает смену освещения) и меряем, насколько края
     одного кадра совпадают с краями другого. У пары с одной точки края лежат
     друг на друге; у пары из разных точек — расходятся.

Пороги подобраны так, чтобы проходила посчитанная пара и не проходила пара
рендеров из концепта. Числа вынесены в константы: это калибровка, а не закон.
"""

from __future__ import annotations

import io
from dataclasses import dataclass

from PIL import Image, ImageChops, ImageFilter, ImageOps

# Доля совпавших краёв, ниже которой пару принимать нельзя.
#
# Порог откалиброван на реальных кадрах концепта: посчитанная пара (геометрия
# совпадает пиксель в пиксель) даёт 0.53, нарисованная отдельно — 0.30, копия
# со сдвигом на 25 px — 0.21. Запас в обе стороны небольшой, и это осознанно:
# ОШИБИТЬСЯ В СТОРОНУ ОТКАЗА здесь дёшево — администратору предлагается
# посчитать ночной кадр, и он получает заведомо совмещённую пару. Ошибка в
# сторону приёма стоит дефекта, который найдут на объекте.
MIN_EDGE_MATCH = 0.45
# Кадр ужимается перед сравнением: нас интересуют стены и мебель, а не шум.
COMPARE_WIDTH = 480
# Порог, выше которого пиксель карты краёв считается краем.
EDGE_THRESHOLD = 26


@dataclass(frozen=True)
class PairVerdict:
    """Итог проверки. `reason` — код для интерфейса, текст пишет фронт."""

    ok: bool
    reason: str = ""
    match: float = 0.0
    lit_size: tuple[int, int] = (0, 0)
    off_size: tuple[int, int] = (0, 0)

    @property
    def as_dict(self) -> dict:
        return {
            "ok": self.ok,
            "reason": self.reason,
            "match": round(self.match, 3),
            "lit_size": list(self.lit_size),
            "off_size": list(self.off_size),
        }


def _edges(image: Image.Image) -> Image.Image:
    """
    Карта краёв в сером. Свет меняет яркость поверхностей, но не то, ГДЕ
    проходят границы: именно они и сравниваются.
    """
    height = max(1, round(image.height * COMPARE_WIDTH / max(1, image.width)))
    small = image.convert("L").resize((COMPARE_WIDTH, height), Image.Resampling.LANCZOS)
    # Лёгкое размытие до поиска краёв: иначе сравниваются шум матрицы и
    # компрессия, а не комната.
    small = small.filter(ImageFilter.GaussianBlur(1.2))
    edges = small.filter(ImageFilter.FIND_EDGES)
    # Нормализация ОБЯЗАТЕЛЬНА: на ночном кадре те же границы слабее в разы
    # просто потому, что он тёмный. Без неё правильная пара выглядела бы как
    # «кадр без структуры» — на первой же калибровке так и вышло.
    return ImageOps.autocontrast(edges, cutoff=1)


def compare(lit_raw: bytes, off_raw: bytes) -> PairVerdict:
    """Проверить пару кадров. Возвращает вердикт с причиной и мерой совпадения."""
    try:
        with Image.open(io.BytesIO(lit_raw)) as lit_image:
            lit_size = lit_image.size
            lit_edges = _edges(lit_image)
        with Image.open(io.BytesIO(off_raw)) as off_image:
            off_size = off_image.size
            off_edges = _edges(off_image)
    except OSError:
        return PairVerdict(ok=False, reason="unreadable")

    if lit_size != off_size:
        return PairVerdict(ok=False, reason="size_mismatch", lit_size=lit_size, off_size=off_size)

    lit_mask = lit_edges.point(lambda value: 255 if value >= EDGE_THRESHOLD else 0)
    off_mask = off_edges.point(lambda value: 255 if value >= EDGE_THRESHOLD else 0)

    lit_count = sum(lit_mask.histogram()[255:])
    off_count = sum(off_mask.histogram()[255:])
    if lit_count == 0 or off_count == 0:
        # На кадре нет ни одной границы — это не комната, а заливка.
        return PairVerdict(ok=False, reason="no_structure", lit_size=lit_size, off_size=off_size)

    # СИММЕТРИЧНО, в обе стороны. Односторонняя мера («сколько краёв ночного
    # нашлось на светлом») даёт тем больше, чем МЕНЬШЕ краёв на ночном кадре, и
    # на калибровке нарисованная пара обошла посчитанную: у тёмного рендера
    # краёв мало, и почти каждый на что-нибудь да попал.
    both = sum(ImageChops.multiply(lit_mask, off_mask).histogram()[255:])
    match = (both / lit_count + both / off_count) / 2

    if match < MIN_EDGE_MATCH:
        return PairVerdict(
            ok=False, reason="not_aligned", match=match, lit_size=lit_size, off_size=off_size
        )
    return PairVerdict(ok=True, match=match, lit_size=lit_size, off_size=off_size)
