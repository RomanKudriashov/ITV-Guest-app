"""
Переводимые метки новых справочников R1 — типы сервисов и коды модулей.

На 4 языках (ru/en/ar/zh), как весь контент. Ключ — code из соответствующего
TextChoices. Метки модулей отдаются в реестре (`title`); метки типов сервиса —
задел под управляющий UI сервисов (реорг CMS, R4) и карточку сервиса.
"""

from __future__ import annotations

SERVICE_TYPE_LABELS = {
    "restaurant":   {"ru": "Ресторан", "en": "Restaurant", "ar": "مطعم", "zh": "餐厅"},
    "bar":          {"ru": "Бар", "en": "Bar", "ar": "بار", "zh": "酒吧"},
    "room_service": {"ru": "Рум-сервис", "en": "Room service", "ar": "خدمة الغرف", "zh": "客房服务"},
    "spa":          {"ru": "СПА", "en": "Spa", "ar": "سبا", "zh": "水疗"},
    "pool":         {"ru": "Бассейн", "en": "Pool", "ar": "مسبح", "zh": "泳池"},
    "transfer":     {"ru": "Трансфер", "en": "Transfer", "ar": "نقل", "zh": "接送"},
    "concierge":    {"ru": "Консьерж", "en": "Concierge", "ar": "الكونسيرج", "zh": "礼宾"},
    "excursions":   {"ru": "Экскурсии", "en": "Excursions", "ar": "رحلات", "zh": "游览"},
    "housekeeping": {"ru": "Хозслужба", "en": "Housekeeping", "ar": "التدبير المنزلي", "zh": "客房清洁"},
    "minibar":      {"ru": "Мини-бар", "en": "Minibar", "ar": "ميني بار", "zh": "迷你吧"},
    "info":         {"ru": "Информация", "en": "Info", "ar": "معلومات", "zh": "信息"},
    "custom":       {"ru": "Свой", "en": "Custom", "ar": "مخصص", "zh": "自定义"},
}

MODULE_LABELS = {
    "room_control":     {"ru": "Управление номером", "en": "Room control", "ar": "التحكم بالغرفة", "zh": "房间控制"},
    "payment":          {"ru": "Оплата", "en": "Payments", "ar": "الدفع", "zh": "支付"},
    "pms":              {"ru": "Система управления отелем", "en": "Hotel management system", "ar": "نظام إدارة الفندق", "zh": "酒店管理系统"},
    "mobile_key":       {"ru": "Мобильный ключ", "en": "Mobile key", "ar": "المفتاح الرقمي", "zh": "移动钥匙"},
    "multi_restaurant": {"ru": "Несколько заведений", "en": "Several venues", "ar": "عدة منافذ", "zh": "多个餐饮场所"},
    "marketing":        {"ru": "Маркетинг", "en": "Marketing", "ar": "التسويق", "zh": "营销"},
    "extra_languages":  {"ru": "Дополнительные языки", "en": "Extra languages", "ar": "لغات إضافية", "zh": "更多语言"},
    "native_app":       {"ru": "Приложение отеля", "en": "Hotel app", "ar": "تطبيق الفندق", "zh": "酒店应用"},
    "analytics_level":  {"ru": "Расширенная аналитика", "en": "Advanced analytics", "ar": "تحليلات متقدمة", "zh": "高级分析"},
}
