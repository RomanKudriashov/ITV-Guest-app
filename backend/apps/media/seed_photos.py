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

    # --- Наглядный каталог R7: меню «Террасы», «Сакуры» и рум-сервиса ---
    # Заводились под конкретное блюдо, а не «что-нибудь съедобное»: без них
    # 36 из 57 активных позиций стояли пустыми карточками.
    "beef-stroganoff": ("1644592219048-5c070fd3c91c", "Karyna Panchenko", "Бефстроганов"),
    "club-sandwich": ("1676300184084-de35d56a9a70", "Orkun Orcan", "Клубный сэндвич"),
    "burger-rs": ("1568901346375-23c9450c58cd", "Amirali Mirhashemian", "Бургер"),
    "mushroom-soup": ("1771089278772-7ad0d9c03f2f", "Unsplash", "Грибной крем-суп"),
    "bruschetta": ("1572695157366-5e585ab2b69f", "Alexandra Kusper", "Брускетта"),
    "duck-breast": ("1774921677530-9031f1ea00ec", "Unsplash", "Утиная грудка"),
    "lamb-rack": ("1761983723667-99c7fd98af53", "Unsplash", "Каре ягнёнка"),
    "salmon-steak": ("1519708227418-c8fd9a32b7a2", "Casey Lee", "Стейк из лосося"),
    "seabass": ("1680405104108-a249b7c3ddf9", "Unsplash", "Сибас"),
    "truffle-risotto": ("1476124369491-e7addf5db371", "Ben Lei", "Ризотто с трюфелем"),
    "nigiri-set": ("1617196034796-73dfa7b1fd56", "Mahmoud Fawzy", "Сет нигири"),
    "philadelphia": ("1759646828324-c215a83828ae", "Vlad Deep", "Ролл «Филадельфия»"),
    "ramen": ("1569718212165-3a8278d5f624", "Cherry Lin", "Рамен"),
    "tempura": ("1759823338930-7996c1787c3b", "Unsplash", "Темпура"),
    "gyoza": ("1708782341487-6544f0d9efe8", "Unsplash", "Гёдза"),
    "unagi": ("1763627719044-5d1d6a6b809c", "note thanun", "Унаги"),
    "california": ("1559410545-0bdcd187e0a6", "Riccardo Bergamini", "Ролл «Калифорния»"),
    "sake": ("1571762450239-f0f047321444", "Kelsey Chance", "Саке"),
    "matcha": ("1515823064-d6e0c04616a7", "Jason Leung", "Матча"),
    "pannacotta": ("1518710101263-54e0350377bb", "Sara Cervera", "Панна-котта"),
    "fresh-orange": ("1600271886742-f049cd451bba", "Mateusz Feliksik", "Апельсиновый фреш"),
    "green-tea": ("1606377695906-236fdfcef767", "Ilya Mashkov", "Зелёный чай"),
    "iced-latte": ("1461023058943-07fcbe16d735", "Demi DeHerrera", "Айс-латте"),
    "margarita": ("1556855810-ac404aa91e85", "Kobby Mendez", "Маргарита"),
    "old-fashioned": ("1621873495884-845a939892d1", "Adam Jaime", "Олд-фешен"),
    "nicoise": ("1655271553809-d200a1240bf6", "Unsplash", "Салат «Нисуаз»"),
    "quinoa-salad": ("1763000215238-38350d3e41ac", "Unsplash", "Салат с киноа"),
    "breakfast-box": ("1641924676578-ed2792eb24de", "Unsplash", "Завтрак в номер"),
    "fruit-plate": ("1523033904333-243d0283acae", "Vitalii Chernopyskyi", "Фруктовая тарелка"),
    "octopus": ("1764397514747-8272f2da3f36", "Unsplash", "Осьминог на гриле"),
    "spicy-tuna": ("1580821082847-c53037ecfe0a", "Derek Duran", "Спайси с тунцом"),
    "veggie-roll": ("1562158074-1602c2f19a08", "Alexandra Kusper", "Овощной ролл"),
    "virgin-mojito": ("1634496064950-02f043806b09", "Unsplash", "Безалкогольный мохито"),
    "soup-day": ("1692776407523-8f3c4678ad36", "Unsplash", "Суп дня"),
    "burrata-salad": ("1760023570385-ee484f7076b3", "Unsplash", "Салат с бурратой"),
    # Тот же «Цезарь», что в меню «Панорамы»: блюдо одно, снимок обязан быть тот
    # же — разные кадры одного блюда в двух меню читаются как разные блюда.
    "caesar-rs": ("1550304943-4f24f54ddde9", "Sara Dubler", "Салат «Цезарь»"),

    # --- Обложки разделов наглядного каталога ---
    # Раздел показывает СВОЁ блюдо: так делает любое меню, и «обложка секции»
    # тут честнее случайного стока. Кадры те же, что у позиций внутри раздела.
    "sakura-sushi": ("1579871494447-9811cf80d66c", "Riccardo Bergamini", "Роллы"),
    "sakura-hot": ("1569718212165-3a8278d5f624", "Cherry Lin", "Горячее"),
    "sakura-drinks": ("1515823064-d6e0c04616a7", "Jason Leung", "Напитки"),
    "terrace-desserts": ("1571877227200-a0d98ea607e9", "American Heritage Chocolate", "Десерты"),
    "room-service-menu": ("1592861956120-e524fc739696", "Roam In Color", "Меню рум-сервиса"),

    # --- Обложка отеля (парадная главной) ---
    "hotel-cover": ("1566073771259-6a8506099945", "Marten Bjork", "Отель «Кристалл»"),

    # --- Флот: заведения и обложки двух других отелей ---
    # У каждого отеля свои кадры. Одинаковая фотография в двух отелях сразу
    # выдаёт демо: white-label должен читаться и по картинке, а не только по
    # цвету акцента.
    "venue-marina": ("1743413515530-b45d0ae079d3", "Unsplash", "Ресторан «Марина»"),
    "venue-laguna-bar": ("1705863009413-43243caf0431", "Unsplash", "Пляжный бар «Лагуна»"),
    "venue-thalasso": ("1676302144341-10563603f99a", "Unsplash", "СПА «Талассо»"),
    "venue-excursions": ("1783809338564-675bb3fd277b", "Unsplash", "Экскурсии"),
    "venue-bistro": ("1686836715835-65af22ea5cd4", "Unsplash", "Бистро «Люмен»"),
    "venue-wine-bar": ("1758827926633-621fb8694e6e", "Unsplash", "Винный бар"),
    "hotel-cover-azure": ("1571003123894-1f0594d2b5d9", "Unsplash", "Азур Резорт"),
    "hotel-cover-lumen": ("1774192621035-20d11389f781", "Unsplash", "Люмен Бутик"),

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
