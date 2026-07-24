"""
Справочники флагов и аллергенов.

Намеренно константы в коде, а не таблицы в БД: набор общий для всех отелей,
меняется вместе с релизом, и его должен одинаково понимать фронт (иконки),
кухня и будущая фильтрация в витрине. Отель выбирает из списка, но не
придумывает свои коды — иначе «vegan» и «vegetarian» разъедутся по отелям и
фильтр перестанет работать.

Аллергены — по 14 обязательным к раскрытию в ЕС; для РФ это тоже покрывает
практику маркировки.
"""

from __future__ import annotations

FLAGS: list[dict] = [
    {"code": "popular", "title": {"ru": "Популярное", "en": "Popular", "ar": "شائع", "zh": "热门"}},
    {"code": "new", "title": {"ru": "Новинка", "en": "New", "ar": "جديد", "zh": "新品"}},
    {"code": "chef_choice", "title": {"ru": "Выбор шефа", "en": "Chef's choice", "ar": "اختيار الشيف", "zh": "主厨推荐"}},
    {"code": "vegan", "title": {"ru": "Веган", "en": "Vegan", "ar": "نباتي صرف", "zh": "纯素"}},
    {"code": "vegetarian", "title": {"ru": "Вегетарианское", "en": "Vegetarian", "ar": "نباتي", "zh": "素食"}},
    {"code": "spicy", "title": {"ru": "Острое", "en": "Spicy", "ar": "حار", "zh": "辣"}},
    {"code": "halal", "title": {"ru": "Халяль", "en": "Halal", "ar": "حلال", "zh": "清真"}},
    {"code": "gluten_free", "title": {"ru": "Без глютена", "en": "Gluten free", "ar": "خالٍ من الغلوتين", "zh": "无麸质"}},
    {"code": "lactose_free", "title": {"ru": "Без лактозы", "en": "Lactose free", "ar": "خالٍ من اللاكتوز", "zh": "无乳糖"}},
    {"code": "alcohol_18plus", "title": {"ru": "18+ / алкоголь", "en": "18+ / alcohol", "ar": "‏18+ / كحول", "zh": "18+ / 含酒精"}},
]

ALLERGENS: list[dict] = [
    {"code": "gluten", "title": {"ru": "Глютен", "en": "Gluten", "ar": "الغلوتين", "zh": "麸质"}},
    {"code": "crustaceans", "title": {"ru": "Ракообразные", "en": "Crustaceans", "ar": "القشريات", "zh": "甲壳类"}},
    {"code": "eggs", "title": {"ru": "Яйца", "en": "Eggs", "ar": "البيض", "zh": "蛋类"}},
    {"code": "fish", "title": {"ru": "Рыба", "en": "Fish", "ar": "السمك", "zh": "鱼类"}},
    {"code": "peanuts", "title": {"ru": "Арахис", "en": "Peanuts", "ar": "الفول السوداني", "zh": "花生"}},
    {"code": "soy", "title": {"ru": "Соя", "en": "Soy", "ar": "الصويا", "zh": "大豆"}},
    {"code": "milk", "title": {"ru": "Молоко", "en": "Milk", "ar": "الحليب", "zh": "牛奶"}},
    {"code": "nuts", "title": {"ru": "Орехи", "en": "Tree nuts", "ar": "المكسرات", "zh": "坚果"}},
    {"code": "celery", "title": {"ru": "Сельдерей", "en": "Celery", "ar": "الكرفس", "zh": "芹菜"}},
    {"code": "mustard", "title": {"ru": "Горчица", "en": "Mustard", "ar": "الخردل", "zh": "芥末"}},
    {"code": "sesame", "title": {"ru": "Кунжут", "en": "Sesame", "ar": "السمسم", "zh": "芝麻"}},
    {"code": "sulphites", "title": {"ru": "Сульфиты", "en": "Sulphites", "ar": "الكبريتيت", "zh": "亚硫酸盐"}},
    {"code": "lupin", "title": {"ru": "Люпин", "en": "Lupin", "ar": "الترمس", "zh": "羽扇豆"}},
    {"code": "molluscs", "title": {"ru": "Моллюски", "en": "Molluscs", "ar": "الرخويات", "zh": "软体动物"}},
]

# Диетические маркеры («подходит») — отдельно от аллергенов («содержит») и от
# маркетинговых бейджей. Подмножество исторического FLAGS: предпочтения и
# предупреждение о возрасте. spicy — это вкус (характеристика), не маркер;
# popular/new/chef_choice — маркетинг (модель Badge). Ими сеются тенант-словари
# при провижининге; отель может добавить свои и деактивировать системные.
DIETARY_MARKERS: list[dict] = [
    entry
    for entry in FLAGS
    if entry["code"] in {"vegan", "vegetarian", "halal", "gluten_free", "lactose_free", "alcohol_18plus"}
]

# Маркетинговые коды из FLAGS, которые переезжают в модель Badge (единый
# источник маркетинга). Пресеты бейджей заведены в brand-библиотеке.
MARKETING_FLAG_CODES = {"popular", "new", "chef_choice"}

DAY_PARTS: list[str] = ["breakfast", "lunch", "dinner", "late_night"]

FLAG_CODES = {entry["code"] for entry in FLAGS}
ALLERGEN_CODES = {entry["code"] for entry in ALLERGENS}
DIETARY_MARKER_CODES = {entry["code"] for entry in DIETARY_MARKERS}
