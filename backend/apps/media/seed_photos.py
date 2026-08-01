"""
Реальные фотографии для демо-контента.

Закрывает долг R1/R2: там обложки РИСОВАЛИСЬ процедурно (градиент с
монограммой) с честной пометкой «фотографию негде взять офлайн». Плана это не
устраивало — «фото только Unsplash/Pexels через медиапайплайн», — и здесь
процедурный генератор заменён настоящими снимками.

Как устроено:

* **Манифест, а не поиск.** Каждому коду сопоставлен КОНКРЕТНЫЙ снимок. Живой
  поиск по ключевому слову давал бы разный результат от прогона к прогону, и
  «наглядный демо-отель» переставал бы быть воспроизводимым.
* **Кэш на диске.** Скачиваем один раз в `.seed_photos/`; повторный сид не
  ходит в сеть вовсе. Каталог примонтирован с хоста, поэтому переживает
  пересборку контейнера.
* **Сеть не обязательна.** Нет сети и нет кэша — сид не падает, а сообщает и
  оставляет позицию без фото. Демо-данные не должны быть причиной, по которой
  не поднимается окружение.
* **Загрузка — тем же медиапайплайном**, что и загрузка из CMS
  (`upload_asset` → MinIO → Celery режет варианты). Отдельного пути для
  демо-картинок нет: он бы и тестировался отдельно.

Лицензия Unsplash разрешает использование без разрешения и без атрибуции, но
авторы указаны — это уважение к чужой работе, а не юридическое требование.
"""

from __future__ import annotations

import logging
import pathlib
import urllib.error
import urllib.request

logger = logging.getLogger(__name__)

# Каталог кэша внутри примонтированного /app — переживает пересборку образа.
CACHE_DIR = pathlib.Path(__file__).resolve().parents[2] / ".seed_photos"

# Ширина под обложку заведения; позиции показываются мельче, но один размер
# проще держать в голове, а медиапайплайн всё равно нарежет варианты.
_WIDTH = 1400
_QUALITY = 75

# код → (id снимка Unsplash, автор, что на снимке)
PHOTOS: dict[str, tuple[str, str, str]] = {
    # --- Блюда и напитки ---
    "caesar": ("1550304943-4f24f54ddde9", "Sara Dubler", "Салат «Цезарь»"),
    "greek-salad": ("1540420773420-3366772f4999", "Elena Koycheva", "Греческий салат"),
    "carbonara": ("1612874742237-6526221588e3", "Ivan Torres", "Паста карбонара"),
    "ribeye": ("1546964124-0cce460f38ef", "Kyle Mackie", "Стейк рибай"),
    "syrniki": ("1567620905732-2d1ec7ab7445", "Toa Heftiba", "Сырники"),
    "burrata": ("1505253716362-afaea1d3d1af", "Eaters Collective", "Буррата"),
    "tiramisu": ("1571877227200-a0d98ea607e9", "American Heritage Chocolate", "Тирамису"),
    "cappuccino": ("1572442388796-11668a67e53d", "Nathan Dumlao", "Капучино"),
    "espresso": ("1510707577719-ae7c14805e3a", "Nathan Dumlao", "Эспрессо"),
    "lemonade": ("1523677011781-c91d1bbe2f9e", "Joanna Kosinska", "Домашний лимонад"),
    "negroni": ("1551024709-8f23befc6f87", "Adam Jaime", "Коктейль «Негрони»"),
    "mojito": ("1551538827-9c037cb4f32a", "Kobby Mendez", "Мохито"),
    "aperol": ("1560512823-829485b8bf24", "Sylvie Tittel", "Апероль-шприц"),
    "mojito-zero": ("1513558161293-cdaf765ed2fd", "Kobby Mendez", "Мохито без алкоголя"),
    "wine-red": ("1510812431401-41d2bd2722f3", "Kelsey Knight", "Красное вино"),
    "wine-white": ("1553361371-9b22f78e8b1d", "Kym Ellis", "Белое вино"),
    # --- Услуги ---
    "massage": ("1544161515-4ab6ce6db874", "Toa Heftiba", "Массаж"),
    "taxi": ("1502877338535-766e1452684a", "Vlad B", "Трансфер"),
    "cleaning": ("1581578731548-c64695cc6952", "No Revisions", "Уборка номера"),
    "wifi": ("1563986768609-322da13575f3", "Bernard Hermant", "Wi-Fi"),
    "about": ("1566073771259-6a8506099945", "Marten Bjork", "Об отеле"),
    # --- Разделы меню ---
    # Категории тоже показываются гостю (шапки разделов, плитки), и в R4 их
    # аудит не покрывал: часть осталась с процедурными обложками, часть без.
    "hot": ("1546069901-ba9599a7e63c", "Brooke Lark", "Горячие блюда"),
    "salads": ("1512621776951-a57141f2eefd", "Anna Pelzer", "Салаты"),
    "drinks": ("1514362545857-3bc16c4c7d1b", "Kelsey Chance", "Напитки"),
    "transfer": ("1502877338535-766e1452684a", "why kei", "Трансфер"),
    "housekeeping": ("1584622650111-993a426fbf0a", "Anthony Tran", "Уборка"),
    "info": ("1564501049412-61c2a3083791", "Manuel Moreno", "Об отеле"),
    "spa": ("1600334089648-b0d9d3028eb2", "Antonika Chanel", "СПА и массаж"),
    "bar-drinks": ("1470337458703-46ad1756a187", "Adam Jaime", "Барная карта"),
    "terrace-starters": ("1476224203421-9ac39bcb3327", "Brooke Lark", "Закуски"),
    "terrace-mains": ("1467003909585-2f8a72700288", "Jay Wennington", "Основные блюда"),
    "sakura-rolls": ("1579871494447-9811cf80d66c", "Riccardo Bergamini", "Роллы"),

    # --- Обложка отеля (парадная главной) ---
    "hotel-cover": ("1566073771259-6a8506099945", "Marten Bjork", "Отель «Кристалл»"),

    # --- Обложки заведений ---
    "venue-kitchen": ("1414235077428-338989a2e8c0", "Jason Leung", "Ресторан «Панорама»"),
    "venue-bar": ("1470337458703-46ad1756a187", "Adam Jaime", "Лобби-бар"),
    "venue-spa": ("1540555700478-4be289fbecef", "Roberto Nickson", "СПА"),
    "venue-concierge": ("1582719508461-905c673771fd", "Sasha Kaunas", "Консьерж"),
    "venue-housekeeping": ("1631049307264-da0ec9d70304", "Vojtech Bruzek", "Хозслужба"),
    "venue-reception": ("1551882547-ff40c63fe5fa", "Jean-Philippe Delberghe", "Ресепшен"),
    "venue-terrace": ("1533777419517-3e4017e2e15a", "Toa Heftiba", "Терраса"),
    "venue-sakura": ("1579027989536-b7b1f875659b", "Jusdevoyage", "Сакура"),
    "venue-room-service": ("1592861956120-e524fc739696", "Roam In Color", "Рум-сервис"),
}


def photo_url(photo_id: str) -> str:
    return f"https://images.unsplash.com/photo-{photo_id}?w={_WIDTH}&q={_QUALITY}&fm=jpg"


def cached_path(code: str) -> pathlib.Path:
    """
    Путь кэша включает ИДЕНТИФИКАТОР снимка, а не только код.

    Иначе кэш и манифест расходятся молча: подменили в манифесте неудачный
    снимок — а на диске лежит старый файл под тем же именем, и сид продолжает
    ставить прежнюю картинку. Ровно так «Такси» много релизов оставалось
    складом: id в манифесте правился, кэш — нет.
    """
    entry = PHOTOS.get(code)
    suffix = f"-{entry[0]}" if entry else ""
    return CACHE_DIR / f"{code}{suffix}.jpg"


def fetch(code: str, *, force: bool = False, timeout: int = 30) -> bytes | None:
    """
    Байты снимка: из кэша, иначе из сети. None — если снимка нет в манифесте
    или сеть недоступна и кэш пуст.
    """
    entry = PHOTOS.get(code)
    if entry is None:
        return None

    path = cached_path(code)
    if path.exists() and not force:
        return path.read_bytes()

    photo_id = entry[0]
    request = urllib.request.Request(
        photo_url(photo_id), headers={"User-Agent": "itv-guest-app-seed/1.0"}
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = response.read()
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        logger.warning("Снимок «%s» не скачался (%s) — позиция останется без фото", code, exc)
        return None

    if not data.startswith(b"\xff\xd8\xff"):
        logger.warning("Снимок «%s» пришёл не JPEG — пропускаю", code)
        return None

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return data


def alt_text(code: str) -> dict[str, str]:
    entry = PHOTOS.get(code)
    return {"ru": entry[2]} if entry else {}


def attribution(code: str) -> str:
    entry = PHOTOS.get(code)
    return f"{entry[1]} / Unsplash" if entry else ""
