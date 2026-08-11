"""
Переводы демо-содержимого: арабский и китайский к уже написанным ru/en.

ЗАЧЕМ ОТДЕЛЬНЫЙ РЕЕСТР, А НЕ ПОЛЯ В СИДАХ. Содержимое демо-отелей заводят два
разных сида — «Кристалл» и флот (`seed_demo_hotel`, `seed_demo_fleet`), — и
каждый описывает позиции своими кортежами `(ru, en)`. Дописать в них ещё два
языка значило бы переписать обе структуры и всё равно оставить существующие
строки в базе непереведёнными: сид создаёт запись один раз и больше к ней не
возвращается. Реестр рядом решает обе задачи: он ДОПИСЫВАЕТ недостающие языки
уже заведённым записям и делает это идемпотентно, при каждом прогоне.

ЧТО НЕ ПЕРЕВОДИТСЯ. Имена собственные — «Кристалл», «Панорама», «Сакура»,
«Марина», «Лагуна», «Талассо», «Люмен». В арабском и китайском они остаются
латиницей: так их пишут в вывесках и картах, и гость, который ищет ресторан по
указателю, найдёт то же слово. Переводится всё вокруг имени — «ресторан»,
«бар», «СПА».

ЗАПОЛНЯЕМ ТОЛЬКО ПУСТОЕ. Правка администратора в CMS сильнее сида: если
название переведено руками, пересев его не тронет.

Автоперевод — в бэклоге. Здесь ровно то, что уже есть на витрине, и ни строкой
больше: реестр не заводит содержимое, а доукомплектовывает его.
"""

from __future__ import annotations

# code → поле модели → язык → текст.
#
# Поля именованы как в моделях: у заведения `public_name`/`tagline`, у раздела
# и позиции `title`/`description`. Один код — одна запись: коды у заведений,
# разделов и позиций не пересекаются (кроме намеренных совпадений вроде `spa`,
# где заведение и раздел названы одинаково и переводятся одинаково же).
# Названия отелей — по ПОДДОМЕНУ: у отеля нет `code`, он один на тенанта.
# Правило то же, что у заведений: имя собственное на всех языках одно и
# латиницей, переводится слово вокруг него («отель», «резорт», «бутик»).
HOTEL_NAMES: dict[str, dict[str, str]] = {
    "crystal": {
        "ru": "Отель «Кристалл»",
        "en": "Crystal Hotel",
        "ar": "فندق Crystal",
        "zh": "Crystal 酒店",
    },
    "azure": {
        "ru": "Азур Резорт",
        "en": "Azure Resort",
        "ar": "منتجع Azure",
        "zh": "Azure 度假村",
    },
    "lumen": {
        "ru": "Люмен Бутик",
        "en": "Lumen Boutique",
        "ar": "بوتيك Lumen",
        "zh": "Lumen 精品酒店",
    },
}

TRANSLATIONS: dict[str, dict[str, dict[str, str]]] = {
    # --- Заведения --------------------------------------------------------
    "kitchen": {
        "public_name": {"ar": "Panorama", "zh": "Panorama"},
        "tagline": {"ar": "مطبخ أوروبي", "zh": "欧陆料理"},
    },
    "terrace": {
        "public_name": {"ar": "التراس", "zh": "露台餐厅"},
        "tagline": {"ar": "نكهات متوسطية على البحر", "zh": "海边地中海风味"},
    },
    "bar": {
        "public_name": {"ar": "بار اللوبي", "zh": "大堂酒吧"},
        "tagline": {"ar": "كوكتيلات ونبيذ", "zh": "鸡尾酒与葡萄酒"},
    },
    "wine-bar": {
        "public_name": {"ar": "بار النبيذ", "zh": "葡萄酒吧"},
        "tagline": {"ar": "نبيذ ومقبلات", "zh": "葡萄酒与小食"},
    },
    "sakura": {
        "public_name": {"ar": "Sakura", "zh": "Sakura"},
        "tagline": {"ar": "مطبخ ياباني", "zh": "日本料理"},
    },
    "marina": {
        "public_name": {"ar": "مطعم Marina", "zh": "Marina 餐厅"},
        "tagline": {"ar": "مأكولات بحرية على الماء", "zh": "临水海鲜"},
    },
    "laguna-bar": {
        "public_name": {"ar": "بار الشاطئ Laguna", "zh": "Laguna 海滩酒吧"},
        "tagline": {"ar": "كوكتيلات عند الماء", "zh": "水畔鸡尾酒"},
    },
    "bistro": {
        "public_name": {"ar": "بيسترو Lumen", "zh": "Lumen 小馆"},
        "tagline": {"ar": "فطور وعشاء", "zh": "早餐与晚餐"},
    },
    "spa": {
        "public_name": {"ar": "سبا Crystal", "zh": "Crystal 水疗中心"},
        "tagline": {"ar": "تدليك وعناية", "zh": "按摩与护理"},
        "title": {"ar": "سبا وتدليك", "zh": "水疗与按摩"},
    },
    "thalasso": {
        "public_name": {"ar": "سبا Thalasso", "zh": "Thalasso 水疗中心"},
        "tagline": {"ar": "علاج بمياه البحر", "zh": "海水疗法"},
    },
    "concierge": {
        "public_name": {"ar": "الكونسيرج", "zh": "礼宾服务"},
        "tagline": {"ar": "تنقلات وجولات ومهام", "zh": "接送、观光与代办"},
    },
    "azure-concierge": {
        "public_name": {"ar": "الكونسيرج", "zh": "礼宾服务"},
        "tagline": {"ar": "التنقل والمساعدة", "zh": "接送与协助"},
    },
    "lumen-concierge": {
        "public_name": {"ar": "الكونسيرج", "zh": "礼宾服务"},
        "tagline": {"ar": "مساعدة الضيف", "zh": "宾客协助"},
    },
    "housekeeping": {
        "public_name": {"ar": "خدمة الغرف والتنظيف", "zh": "客房清洁"},
        "title": {"ar": "التنظيف", "zh": "清洁"},
    },
    "azure-housekeeping": {
        "public_name": {"ar": "خدمة الغرف والتنظيف", "zh": "客房清洁"},
        "tagline": {"ar": "تنظيف وبياضات", "zh": "清洁与布草"},
    },
    "excursions": {
        "public_name": {"ar": "الجولات", "zh": "观光行程"},
        "tagline": {"ar": "رحلات بحرية", "zh": "海上行程"},
    },
    "room_service": {
        "public_name": {"ar": "خدمة الغرف", "zh": "送餐服务"},
        "tagline": {"ar": "إلى غرفتك على مدار الساعة", "zh": "24 小时送餐到房"},
    },
    "azure-room-service": {
        "public_name": {"ar": "خدمة الغرف", "zh": "送餐服务"},
        "tagline": {"ar": "إلى غرفتك على مدار الساعة", "zh": "24 小时送餐到房"},
    },
    "lumen-room-service": {
        "public_name": {"ar": "خدمة الغرف", "zh": "送餐服务"},
        "tagline": {"ar": "إلى غرفتك حتى منتصف الليل", "zh": "送餐到房至午夜"},
    },
    "azure-info": {
        "public_name": {"ar": "عن الفندق", "zh": "关于酒店"},
        "tagline": {"ar": "كل شيء عن المنتجع", "zh": "度假村全知道"},
    },
    "lumen-info": {
        "public_name": {"ar": "عن الفندق", "zh": "关于酒店"},
        "tagline": {"ar": "أهم المعلومات باختصار", "zh": "简要须知"},
    },
    # --- Разделы ----------------------------------------------------------
    "hot": {"title": {"ar": "أطباق ساخنة", "zh": "热菜"}},
    "salads": {"title": {"ar": "سلطات", "zh": "沙拉"}},
    "drinks": {"title": {"ar": "مشروبات", "zh": "饮品"}},
    "bar-drinks": {"title": {"ar": "كوكتيلات ونبيذ", "zh": "鸡尾酒与葡萄酒"}},
    "bar-cocktails": {"title": {"ar": "كوكتيلات", "zh": "鸡尾酒"}},
    "wine-list": {"title": {"ar": "قائمة النبيذ", "zh": "酒单"}},
    "sakura-sushi": {"title": {"ar": "سوشي ورولات", "zh": "寿司与卷物"}},
    "sakura-hot": {"title": {"ar": "أطباق ساخنة", "zh": "热菜"}},
    "sakura-drinks": {"title": {"ar": "مشروبات", "zh": "饮品"}},
    "terrace-starters": {"title": {"ar": "مقبلات", "zh": "前菜"}},
    "terrace-mains": {"title": {"ar": "الأطباق الرئيسية", "zh": "主菜"}},
    "terrace-desserts": {"title": {"ar": "حلويات", "zh": "甜点"}},
    "marina-starters": {"title": {"ar": "مقبلات", "zh": "前菜"}},
    "marina-mains": {"title": {"ar": "الأطباق الرئيسية", "zh": "主菜"}},
    "marina-desserts": {"title": {"ar": "حلويات", "zh": "甜点"}},
    "laguna-cocktails": {"title": {"ar": "كوكتيلات", "zh": "鸡尾酒"}},
    "laguna-soft": {"title": {"ar": "مشروبات منعشة", "zh": "清凉饮品"}},
    "bistro-breakfast": {"title": {"ar": "فطور", "zh": "早餐"}},
    "bistro-mains": {"title": {"ar": "الأطباق الرئيسية", "zh": "主菜"}},
    "room-service-menu": {"title": {"ar": "إلى الغرفة", "zh": "送餐到房"}},
    "azure-night": {"title": {"ar": "قائمة الليل", "zh": "夜宵菜单"}},
    "lumen-night": {"title": {"ar": "قائمة الليل", "zh": "夜宵菜单"}},
    "transfer": {"title": {"ar": "التنقل", "zh": "接送"}},
    "concierge-tours": {"title": {"ar": "الجولات والترفيه", "zh": "观光与休闲"}},
    "concierge-errands": {"title": {"ar": "المهام", "zh": "代办事项"}},
    "info": {"title": {"ar": "عن الفندق", "zh": "关于酒店"}},
    "azure-info-pages": {"title": {"ar": "عن الفندق", "zh": "关于酒店"}},
    "lumen-info-pages": {"title": {"ar": "عن الفندق", "zh": "关于酒店"}},
    "azure-concierge-requests": {"title": {"ar": "الكونسيرج", "zh": "礼宾服务"}},
    "lumen-concierge-requests": {"title": {"ar": "الكونسيرج", "zh": "礼宾服务"}},
    "azure-housekeeping-requests": {"title": {"ar": "خدمة الغرف والتنظيف", "zh": "客房清洁"}},
    "excursions-slots": {"title": {"ar": "الجولات", "zh": "观光行程"}},
    "thalasso-slots": {"title": {"ar": "سبا Thalasso", "zh": "Thalasso 水疗中心"}},
    # --- Позиции: кухня ---------------------------------------------------
    "ribeye": {
        "title": {"ar": "ستيك ريب آي", "zh": "肋眼牛排"},
        "description": {"ar": "لحم بقري مرمري، 300 غرام، مشوي", "zh": "雪花牛肉 300 克，炭烤"},
    },
    "carbonara": {
        "title": {"ar": "باستا كاربونارا", "zh": "卡邦尼意面"},
        "description": {"ar": "غوانشالي وجبن بيكورينو", "zh": "腌猪颊肉、佩科里诺奶酪"},
    },
    "salmon-steak": {
        "title": {"ar": "ستيك سلمون", "zh": "三文鱼排"},
        "description": {"ar": "مع خضار مشوية", "zh": "配烤蔬菜"},
    },
    "duck-breast": {
        "title": {"ar": "صدر بط", "zh": "鸭胸"},
        "description": {"ar": "بصلصة الكرز", "zh": "配樱桃酱"},
    },
    "mushroom-soup": {
        "title": {"ar": "شوربة كريمة الفطر البورشيني", "zh": "牛肝菌奶油汤"},
        "description": {"ar": "بزيت الكمأة", "zh": "配松露油"},
    },
    "truffle-risotto": {
        "title": {"ar": "ريزوتو بالكمأة", "zh": "松露烩饭"},
        "description": {"ar": "أرز كارنارولي وجبن البارميزان", "zh": "卡纳罗利米、帕玛森奶酪"},
    },
    "lamb-rack": {
        "title": {"ar": "ريش ضأن", "zh": "羊排"},
        "description": {"ar": "بإكليل الجبل والخضار", "zh": "配迷迭香与蔬菜"},
    },
    "seabass": {
        "title": {"ar": "سمك القاروص المشوي", "zh": "炭烤海鲈"},
        "description": {"ar": "كامل، مع الليمون", "zh": "整条，配柠檬"},
    },
    "octopus": {
        "title": {"ar": "أخطبوط مشوي", "zh": "炭烤章鱼"},
        "description": {"ar": "مع بطاطس مطهوة ببطء", "zh": "配油封土豆"},
    },
    "beef-stroganoff": {
        "title": {"ar": "بيف ستروغانوف", "zh": "俄式牛柳"},
        "description": {"ar": "مع بطاطس مهروسة", "zh": "配土豆泥"},
    },
    "soup-day": {
        "title": {"ar": "شوربة اليوم", "zh": "每日例汤"},
        "description": {"ar": "اسأل الموظف", "zh": "请咨询服务员"},
    },
    "syrniki": {
        "title": {"ar": "فطائر الجبن سيرنيكي", "zh": "俄式奶酪饼"},
        "description": {"ar": "مع القشدة الحامضة", "zh": "配酸奶油"},
    },
    # --- Позиции: салаты и закуски ---------------------------------------
    "caesar": {
        "title": {"ar": "سلطة سيزر", "zh": "凯撒沙拉"},
        "description": {"ar": "دجاج، بارميزان، صلصة سيزر", "zh": "鸡肉、帕玛森奶酪、凯撒酱"},
    },
    "caesar-rs": {
        "title": {"ar": "سلطة سيزر إلى الغرفة", "zh": "凯撒沙拉（送房）"},
        "description": {"ar": "دجاج وبارميزان", "zh": "鸡肉、帕玛森奶酪"},
    },
    "greek-salad": {
        "title": {"ar": "سلطة يونانية", "zh": "希腊沙拉"},
        "description": {"ar": "فيتا، خيار، طماطم، زيتون", "zh": "菲达奶酪、黄瓜、番茄、橄榄"},
    },
    "burrata-salad": {
        "title": {"ar": "سلطة البوراتا", "zh": "布拉塔沙拉"},
        "description": {"ar": "طماطم وجرجير", "zh": "番茄、芝麻菜"},
    },
    "burrata": {
        "title": {"ar": "بوراتا", "zh": "布拉塔奶酪"},
        "description": {"ar": "جبن بوراتا كريمي مع البيستو", "zh": "布拉塔奶酪配青酱"},
    },
    "nicoise": {
        "title": {"ar": "سلطة نيسواز", "zh": "尼斯沙拉"},
        "description": {"ar": "تونة، بيض، زيتون", "zh": "金枪鱼、鸡蛋、橄榄"},
    },
    "quinoa-salad": {
        "title": {"ar": "سلطة الكينوا", "zh": "藜麦沙拉"},
        "description": {"ar": "أفوكادو وتوفو", "zh": "牛油果、豆腐"},
    },
    "bruschetta": {
        "title": {"ar": "بروسكيتا", "zh": "意式烤面包"},
        "description": {"ar": "طماطم، ريحان، خبز تشاباتا", "zh": "番茄、罗勒、恰巴塔面包"},
    },
    "fruit-plate": {
        "title": {"ar": "طبق فواكه", "zh": "水果拼盘"},
        "description": {"ar": "فواكه موسمية", "zh": "时令水果"},
    },
    # --- Позиции: японская кухня -----------------------------------------
    "nigiri-set": {
        "title": {"ar": "طقم نيغيري", "zh": "握寿司拼盘"},
        "description": {"ar": "8 قطع، تشكيلة", "zh": "8 件，什锦"},
    },
    "philadelphia": {
        "title": {"ar": "رول فيلادلفيا", "zh": "费城卷"},
        "description": {"ar": "سلمون وجبن كريمي", "zh": "三文鱼、奶油奶酪"},
    },
    "california": {
        "title": {"ar": "رول كاليفورنيا", "zh": "加州卷"},
        "description": {"ar": "سلطعون، أفوكادو، بيض السمك", "zh": "蟹肉、牛油果、鱼子"},
    },
    "spicy-tuna": {
        "title": {"ar": "تونة حارة", "zh": "辣金枪鱼"},
        "description": {"ar": "تونة بصلصة حارة", "zh": "金枪鱼配辣酱"},
    },
    "unagi": {
        "title": {"ar": "رول أوناغي", "zh": "鳗鱼卷"},
        "description": {"ar": "أنقليس مدخن وصلصة", "zh": "烟熏鳗鱼、酱汁"},
    },
    "veggie-roll": {
        "title": {"ar": "رول نباتي", "zh": "蔬菜卷"},
        "description": {"ar": "أفوكادو وخيار", "zh": "牛油果、黄瓜"},
    },
    "ramen": {
        "title": {"ar": "رامن", "zh": "拉面"},
        "description": {"ar": "لحم خنزير تشاشو وبيضة", "zh": "叉烧、溏心蛋"},
    },
    "gyoza": {
        "title": {"ar": "غيوزا", "zh": "煎饺"},
        "description": {"ar": "فطائر مقلية، 6 قطع", "zh": "香煎饺子 6 只"},
    },
    "tempura": {
        "title": {"ar": "تمبورا", "zh": "天妇罗"},
        "description": {"ar": "روبيان مقلي بالعجينة", "zh": "香炸虾"},
    },
    "sake": {
        "title": {"ar": "ساكي", "zh": "清酒"},
        "description": {"ar": "دافئ، 150 مل", "zh": "温酒 150 毫升"},
    },
    # --- Позиции: напитки --------------------------------------------------
    "espresso": {
        "title": {"ar": "إسبريسو", "zh": "浓缩咖啡"},
        "description": {"ar": "مزدوج", "zh": "双份"},
    },
    "cappuccino": {
        "title": {"ar": "كابتشينو", "zh": "卡布奇诺"},
        "description": {"ar": "مع اختيار الحليب", "zh": "可选奶品"},
    },
    "iced-latte": {
        "title": {"ar": "لاتيه مثلج", "zh": "冰拿铁"},
        "description": {"ar": "مع اختيار الحليب", "zh": "可选奶品"},
    },
    "matcha": {
        "title": {"ar": "لاتيه ماتشا", "zh": "抹茶拿铁"},
        "description": {"ar": "مع اختيار الحليب", "zh": "可选奶品"},
    },
    "green-tea": {
        "title": {"ar": "شاي أخضر", "zh": "绿茶"},
        "description": {"ar": "سينشا", "zh": "煎茶"},
    },
    "fresh-orange": {
        "title": {"ar": "عصير برتقال طازج", "zh": "鲜榨橙汁"},
        "description": {"ar": "طازج العصر", "zh": "现榨"},
    },
    "lemonade": {
        "title": {"ar": "ليموناضة منزلية", "zh": "自制柠檬水"},
        "description": {"ar": "ليمون، نعناع، 400 مل", "zh": "柠檬、薄荷，400 毫升"},
    },
    "mojito": {
        "title": {"ar": "موخيتو", "zh": "莫吉托"},
        "description": {"ar": "روم، نعناع، ليمون أخضر", "zh": "朗姆酒、薄荷、青柠"},
    },
    "mojito-zero": {
        "title": {"ar": "موخيتو بدون كحول", "zh": "无酒精莫吉托"},
        "description": {"ar": "ليمون أخضر، نعناع، صودا", "zh": "青柠、薄荷、苏打水"},
    },
    "virgin-mojito": {
        "title": {"ar": "موخيتو بدون كحول", "zh": "无酒精莫吉托"},
        "description": {"ar": "نعناع، ليمون أخضر، صودا", "zh": "薄荷、青柠、苏打水"},
    },
    "negroni": {
        "title": {"ar": "نيغروني", "zh": "尼格罗尼"},
        "description": {"ar": "جن، كامباري، فيرموث أحمر", "zh": "金酒、金巴利、红味美思"},
    },
    "margarita": {
        "title": {"ar": "مارغريتا", "zh": "玛格丽特"},
        "description": {"ar": "تكيلا، ليمون أخضر، تريبل سيك", "zh": "龙舌兰、青柠、橙皮酒"},
    },
    "old-fashioned": {
        "title": {"ar": "أولد فاشند", "zh": "古典鸡尾酒"},
        "description": {"ar": "ويسكي وبيتر", "zh": "威士忌、苦精"},
    },
    "aperol": {
        "title": {"ar": "أبيرول سبريتز", "zh": "阿佩罗气泡饮"},
        "description": {"ar": "أبيرول، بروسيكو، صودا", "zh": "阿佩罗、普罗塞克、苏打水"},
    },
    "wine-red": {
        "title": {"ar": "نبيذ أحمر", "zh": "红葡萄酒"},
        "description": {"ar": "كأس 150 مل", "zh": "一杯 150 毫升"},
    },
    "wine-white": {
        "title": {"ar": "نبيذ أبيض", "zh": "白葡萄酒"},
        "description": {"ar": "كأس 150 مل", "zh": "一杯 150 毫升"},
    },
    # --- Позиции: рум-сервис и завтраки -----------------------------------
    "club-sandwich": {
        "title": {"ar": "ساندويتش كلوب", "zh": "总汇三明治"},
        "description": {"ar": "حتى منتصف الليل", "zh": "供应至午夜"},
    },
    "burger-rs": {
        "title": {"ar": "برغر", "zh": "汉堡"},
        "description": {"ar": "لحم بقري، شيدر، صلصة", "zh": "牛肉、切达奶酪、酱汁"},
    },
    "breakfast-box": {
        "title": {"ar": "فطور إلى الغرفة", "zh": "早餐送房"},
        "description": {"ar": "طقم لشخص واحد", "zh": "单人份"},
    },
    "pannacotta": {
        "title": {"ar": "بانا كوتا", "zh": "意式奶冻"},
        "description": {"ar": "بصلصة التوت", "zh": "配莓果酱"},
    },
    "tiramisu": {
        "title": {"ar": "تيراميسو", "zh": "提拉米苏"},
        "description": {"ar": "كلاسيكي بجبن الماسكاربوني", "zh": "经典马斯卡彭"},
    },
    # --- Позиции: услуги и заявки -----------------------------------------
    "cleaning": {
        "title": {"ar": "تنظيف الغرفة", "zh": "客房清洁"},
        "description": {"ar": "نأتي في الوقت المناسب لك", "zh": "按您方便的时间上门"},
    },
    "cleaning-azure": {
        "title": {"ar": "تنظيف الغرفة", "zh": "客房清洁"},
        "description": {"ar": "في الوقت المناسب لك", "zh": "按您方便的时间"},
    },
    "taxi": {
        "title": {"ar": "سيارة أجرة", "zh": "出租车"},
        "description": {"ar": "نُحضر السيارة إلى مدخل الفندق", "zh": "将车安排到酒店门口"},
    },
    # --- Услуги консьержа (G12) -------------------------------------------
    "airport-pickup": {
        "title": {"ar": "الاستقبال من المطار", "zh": "机场接机"},
        "description": {
            "ar": "نستقبلك بلافتة ونوصلك إلى الفندق",
            "zh": "举牌接机并送至酒店",
        },
    },
    "airport-dropoff": {
        "title": {"ar": "التوصيل إلى المطار", "zh": "送机服务"},
        "description": {
            "ar": "سيارة عند المدخل ومساعدة في الأمتعة",
            "zh": "门口备车并协助搬运行李",
        },
    },
    "car-rental": {
        "title": {"ar": "تأجير سيارة", "zh": "租车"},
        "description": {
            "ar": "نختار السيارة وننهي الأوراق",
            "zh": "为您选车并办妥手续",
        },
    },
    "city-tour": {
        "title": {"ar": "الجولات السياحية", "zh": "导览游"},
        "description": {
            "ar": "جولات عامة وموضوعية مع مرشد",
            "zh": "城市与主题线路，配导游",
        },
    },
    "tickets": {
        "title": {"ar": "التذاكر", "zh": "票务"},
        "description": {
            "ar": "مسرح وحفلات ومتاحف — نجدها ونشتريها",
            "zh": "剧院、演出、博物馆，代找代购",
        },
    },
    "table-booking": {
        "title": {"ar": "حجز المطاعم", "zh": "餐厅预订"},
        "description": {
            "ar": "نحجز لك طاولة في المدينة باسمك",
            "zh": "以您的名义预订城中餐位",
        },
    },
    "flowers": {
        "title": {"ar": "توصيل الزهور", "zh": "鲜花配送"},
        "description": {
            "ar": "نجهّز الباقة ونوصلها في الوقت المحدد",
            "zh": "配好花束并按时送达",
        },
    },
    "babysitter": {
        "title": {"ar": "جليسة أطفال", "zh": "临时保姆"},
        "description": {
            "ar": "جليسة موثوقة لبضع ساعات",
            "zh": "可靠保姆，按小时安排",
        },
    },
    "laundry-service": {
        "title": {"ar": "الغسيل والكي", "zh": "洗衣与熨烫"},
        "description": {
            "ar": "نأخذ الملابس من الغرفة ونعيدها جاهزة",
            "zh": "从客房取走，整理妥当送回",
        },
    },
    "transfer-azure": {
        "title": {"ar": "التنقل", "zh": "接送"},
        "description": {"ar": "السيارة عند المدخل", "zh": "车辆在门口等候"},
    },
    "transfer-lumen": {
        "title": {"ar": "التنقل", "zh": "接送"},
        "description": {"ar": "السيارة عند المدخل", "zh": "车辆在门口等候"},
    },
    "massage": {
        "title": {"ar": "تدليك 60 دقيقة", "zh": "按摩 60 分钟"},
        "description": {"ar": "تدليك كلاسيكي", "zh": "经典按摩"},
    },
    "thalasso-massage": {
        "title": {"ar": "تدليك 60 دقيقة", "zh": "按摩 60 分钟"},
        "description": {"ar": "كلاسيكي", "zh": "经典"},
    },
    "thalasso-bath": {
        "title": {"ar": "حمام مياه البحر", "zh": "海水浴"},
        "description": {"ar": "30 دقيقة", "zh": "30 分钟"},
    },
    "boat-trip": {
        "title": {"ar": "رحلة بحرية", "zh": "海上巡游"},
        "description": {"ar": "ساعتان على طول الساحل", "zh": "沿海岸 2 小时"},
    },
    "azure-beach": {
        "title": {"ar": "الشاطئ", "zh": "海滩"},
        "description": {
            "ar": "مناشف عند المسبح من 8:00 حتى 20:00.",
            "zh": "泳池边毛巾服务，8:00 至 20:00。",
        },
    },
    # --- Позиции: информационные страницы ---------------------------------
    "about": {"title": {"ar": "عن فندقنا", "zh": "关于本酒店"}},
    "wifi": {
        "title": {"ar": "واي فاي وإنترنت", "zh": "无线网络"},
        "description": {"ar": "كيفية الاتصال", "zh": "如何连接"},
    },
    "azure-wifi": {
        "title": {"ar": "واي فاي", "zh": "无线网络"},
        "description": {
            "ar": "شبكة AZURE-GUEST، كلمة المرور على بطاقة الضيف.",
            "zh": "网络 AZURE-GUEST，密码见宾客卡。",
        },
    },
    "lumen-wifi": {
        "title": {"ar": "واي فاي", "zh": "无线网络"},
        "description": {
            "ar": "شبكة LUMEN، كلمة المرور عند الاستقبال.",
            "zh": "网络 LUMEN，密码请向前台索取。",
        },
    },
}

# Состав позиции живёт НЕ отдельным полем модели, а внутри
# `attributes.nutrition.composition`, и переводится тем же реестром — гость
# читает эту строку на карточке наравне с описанием.
COMPOSITIONS: dict[str, dict[str, str]] = {
    "aperol": {"ar": "أبيرول، بروسيكو، صودا", "zh": "阿佩罗、普罗塞克、苏打水"},
    "caesar": {
        "ar": "دجاج، بارميزان، صلصة سيزر",
        "zh": "鸡肉、帕玛森奶酪、凯撒酱",
    },
    "cappuccino": {"ar": "مع اختيار الحليب", "zh": "可选奶品"},
    "carbonara": {
        "ar": "غوانشالي، بيكورينو، صفار البيض",
        "zh": "腌猪颊肉、佩科里诺奶酪、蛋黄",
    },
    "greek-salad": {
        "ar": "فيتا، خيار، طماطم، زيتون",
        "zh": "菲达奶酪、黄瓜、番茄、橄榄",
    },
    "lemonade": {"ar": "ليمون، نعناع، 400 مل", "zh": "柠檬、薄荷，400 毫升"},
    "negroni": {
        "ar": "جن، كامباري، فيرموث أحمر",
        "zh": "金酒、金巴利、红味美思",
    },
    "ribeye": {
        "ar": "لحم بقري مرمري، 300 غرام، مشوي",
        "zh": "雪花牛肉 300 克，炭烤",
    },
    "syrniki": {
        "ar": "مع القشدة الحامضة والمربى، للفطور فقط",
        "zh": "配酸奶油与果酱，仅早餐供应",
    },
}

# Характеристики позиции — короткие пары «название → значение», и их немного.
# Ключ — русский текст: он есть у всех строк и не меняется от отеля к отелю.
CHARACTERISTIC_TEXTS: dict[str, dict[str, str]] = {
    "Способ приготовления": {"ar": "طريقة الطهي", "zh": "烹饪方式"},
    "Гриль": {"ar": "مشوي", "zh": "炭烤"},
    "Вкус": {"ar": "المذاق", "zh": "口味"},
    "Насыщенный": {"ar": "غني", "zh": "浓郁"},
    "Сливочный": {"ar": "كريمي", "zh": "奶香"},
    "Подача": {"ar": "التقديم", "zh": "上菜"},
    "Горячая": {"ar": "ساخن", "zh": "热食"},
    "Холодная": {"ar": "بارد", "zh": "冷食"},
}

# Модификаторы: группы («Прожарка», «Добавки») и их варианты. Ключ — русский
# текст: он один на все отели, а привязывать перевод к позиции значило бы
# повторять «Медиум рэр» у каждого стейка отдельно.
MODIFIER_TEXTS: dict[str, dict[str, str]] = {
    "Прожарка": {"ar": "درجة النضج", "zh": "熟度"},
    "С кровью": {"ar": "نيء قليلاً", "zh": "一分熟"},
    "Медиум рэр": {"ar": "متوسط النضج قليلاً", "zh": "三分熟"},
    "Медиум": {"ar": "متوسط النضج", "zh": "五分熟"},
    "Прожаренный": {"ar": "ناضج تماماً", "zh": "全熟"},
    "Добавки": {"ar": "إضافات", "zh": "加料"},
    "Перечный соус": {"ar": "صلصة الفلفل", "zh": "胡椒酱"},
    "Овощи гриль": {"ar": "خضار مشوية", "zh": "烤蔬菜"},
    "Картофель с трюфелем": {"ar": "بطاطس بالكمأة", "zh": "松露薯条"},
    "Молоко": {"ar": "الحليب", "zh": "奶品"},
    "Обычное": {"ar": "عادي", "zh": "普通牛奶"},
    "Овсяное": {"ar": "حليب الشوفان", "zh": "燕麦奶"},
    "Миндальное": {"ar": "حليب اللوز", "zh": "杏仁奶"},
}

# Поля, которые дописываем каждой модели. Порядок не важен, важен состав:
# именно эти поля видит гость на карточке.
FIELDS = {
    "Service": ("public_name", "tagline"),
    "Category": ("title",),
    "Item": ("title", "description"),
}


def fill_translations() -> dict[str, int]:
    """
    Дописать недостающие языки заведениям, разделам и позициям текущего отеля.

    Возвращает счётчики заполненных полей по языкам. Вызывать В КОНТЕКСТЕ
    ТЕНАНТА: реестр общий, а записи у каждого отеля свои.

    ЗАПОЛНЯЕТСЯ ТОЛЬКО ПУСТОЕ. Строка, написанная человеком в CMS, сильнее
    реестра: пересев не должен переписывать чужую работу.
    """
    from apps.catalog.models import (
        Category,
        Item,
        ItemCharacteristic,
        ModifierGroup,
        ModifierOption,
    )
    from apps.hotels.models import Service

    filled: dict[str, int] = {}
    for model in (Service, Category, Item):
        fields = FIELDS[model.__name__]
        for row in model.objects.all():
            spec = TRANSLATIONS.get(row.code or "")
            if not spec:
                continue
            touched = []
            for field in fields:
                languages = spec.get(field)
                if not languages:
                    continue
                value = dict(getattr(row, field) or {})
                for code, text in languages.items():
                    if (value.get(code) or "").strip():
                        continue
                    value[code] = text
                    filled[code] = filled.get(code, 0) + 1
                    touched.append(field)
                setattr(row, field, value)
            if touched:
                row.save(update_fields=[*dict.fromkeys(touched), "updated_at"])

    _fill_hotel_name(filled)
    _fill_compositions(Item, filled)
    _fill_characteristics(ItemCharacteristic, filled)
    _fill_by_text(ModifierGroup, ("title",), MODIFIER_TEXTS, filled)
    _fill_by_text(ModifierOption, ("title",), MODIFIER_TEXTS, filled)
    return filled


def _fill_hotel_name(filled: dict[str, int]) -> None:
    """
    Название отеля на четырёх языках.

    Отель ровно один на тенанта, и берётся он из контекста — реестр ключуется
    поддоменом. Как и везде здесь: дописываем только ПУСТОЕ, правка оператора
    в CMS сильнее сида.
    """
    from apps.core.context import require_hotel_id
    from apps.hotels.models import Hotel

    hotel = Hotel.objects.filter(pk=require_hotel_id()).first()
    if hotel is None:
        return
    spec = HOTEL_NAMES.get(hotel.subdomain or "")
    if not spec:
        return
    value = dict(hotel.name or {})
    touched = False
    for code, text in spec.items():
        if (value.get(code) or "").strip():
            continue
        value[code] = text
        filled[code] = filled.get(code, 0) + 1
        touched = True
    if touched:
        hotel.name = value
        hotel.save(update_fields=["name", "updated_at"])


def _fill_by_text(model, fields, registry: dict[str, dict[str, str]], filled: dict[str, int]) -> None:
    """Перевод по русскому тексту поля — для коротких повторяющихся строк."""
    for row in model.objects.all():
        touched = []
        for field in fields:
            value = dict(getattr(row, field) or {})
            languages = registry.get((value.get("ru") or "").strip())
            if not languages:
                continue
            for code, text in languages.items():
                if (value.get(code) or "").strip():
                    continue
                value[code] = text
                filled[code] = filled.get(code, 0) + 1
                touched.append(field)
            setattr(row, field, value)
        if touched:
            row.save(update_fields=[*dict.fromkeys(touched), "updated_at"])


def _fill_compositions(item_model, filled: dict[str, int]) -> None:
    """Состав внутри `attributes.nutrition.composition` — тем же правилом."""
    for item in item_model.objects.all():
        languages = COMPOSITIONS.get(item.code or "")
        if not languages:
            continue
        attributes = dict(item.attributes or {})
        nutrition = dict(attributes.get("nutrition") or {})
        composition = dict(nutrition.get("composition") or {})
        # ПЕРЕВОДИМ ТО, ЧТО ЕСТЬ, а не заводим новое. У позиции с тем же кодом в
        # другом отеле состава может не быть вовсе — дописав туда перевод, мы
        # выдумали бы содержимое и вдобавок создали пустой блок КБЖУ, в котором
        # нет ни одной цифры.
        if not any((value or "").strip() for value in composition.values()):
            continue
        changed = False
        for code, text in languages.items():
            if (composition.get(code) or "").strip():
                continue
            composition[code] = text
            filled[code] = filled.get(code, 0) + 1
            changed = True
        if not changed:
            continue
        nutrition["composition"] = composition
        attributes["nutrition"] = nutrition
        item.attributes = attributes
        item.save(update_fields=["attributes", "updated_at"])


def _fill_characteristics(model, filled: dict[str, int]) -> None:
    """
    Характеристики переводятся ПО ТЕКСТУ, а не по коду позиции: «Вкус →
    Насыщенный» повторяется у разных блюд, и держать перевод при каждом блюде
    значило бы повторять одно и то же по десятку раз.
    """
    _fill_by_text(model, ("name", "value"), CHARACTERISTIC_TEXTS, filled)
