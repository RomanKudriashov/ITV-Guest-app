"""
Шаблоны онбординга: заведение отеля не с нуля, а с рабочего каркаса.

Что шаблон делает: создаёт сервисы, проставляет тариф и модули, задаёт языки и
пресет оформления. Что он НЕ делает: не остаётся связанным с отелем. После
заведения отель живёт сам, и правка шаблона задним числом ничего у него не
меняет — иначе платформа могла бы молча переписать чужой отель.

Стартовый набор шаблонов и системный справочник засеваются из кода один раз
(`ensure_seed`) и дальше редактируются платформой. Код здесь — не источник
правды, а первое наполнение пустой базы: без него первый запуск дал бы
владельцу платформы пустые экраны и вопрос «а что тут вообще бывает».
"""

from __future__ import annotations

from django.db import transaction

from apps.core.errors import NotFoundError, ValidationError
from apps.hotels.models import (
    ExecutionPoint,
    Hotel,
    OnboardingTemplate,
    Service,
    SystemDictionaryEntry,
)

# --- Стартовое наполнение --------------------------------------------------

SEED_TEMPLATES = [
    {
        "code": "restaurant_hotel",
        "title": {"ru": "Ресторанный отель", "en": "Restaurant hotel",
                  "ar": "فندق بمطاعم", "zh": "餐饮型酒店"},
        "description": {"ru": "Ресторан, бар и рум-сервис — то, с чего живёт городской отель.",
                        "en": "Restaurant, bar and room service — a city hotel's core.",
                        "ar": "مطعم وبار وخدمة الغرف — أساس فندق المدينة.",
                        "zh": "餐厅、酒吧与客房服务 — 城市酒店的核心。"},
        "tariff": "business",
        "services": [
            {"type": "restaurant", "name": {"ru": "Ресторан", "en": "Restaurant"}},
            {"type": "bar", "name": {"ru": "Бар", "en": "Bar"}},
            {"type": "room_service", "name": {"ru": "Рум-сервис", "en": "Room service"}},
            {"type": "concierge", "name": {"ru": "Консьерж", "en": "Concierge"}},
        ],
        "modules": ["multi_restaurant", "marketing"],
        "languages": ["ru", "en"],
        "preset": "midnight_navy",
        "sort_order": 10,
    },
    {
        "code": "resort",
        "title": {"ru": "Курорт", "en": "Resort", "ar": "منتجع", "zh": "度假村"},
        "description": {"ru": "Несколько заведений, спа и бассейн: у курорта заказ живёт вне номера.",
                        "en": "Several venues, spa and pool: at a resort the order lives outside the room.",
                        "ar": "عدة منشآت وسبا ومسبح: في المنتجع يعيش الطلب خارج الغرفة.",
                        "zh": "多个场所、水疗与泳池：度假村的订单发生在客房之外。"},
        "tariff": "resort",
        "services": [
            {"type": "restaurant", "name": {"ru": "Основной ресторан", "en": "Main restaurant"}},
            {"type": "bar", "name": {"ru": "Пляжный бар", "en": "Beach bar"}},
            {"type": "spa", "name": {"ru": "СПА", "en": "Spa"}},
            {"type": "pool", "name": {"ru": "Бассейн", "en": "Pool"}},
            {"type": "excursions", "name": {"ru": "Экскурсии", "en": "Excursions"}},
            {"type": "housekeeping", "name": {"ru": "Хозслужба", "en": "Housekeeping"}},
        ],
        "modules": ["multi_restaurant", "marketing", "room_control", "extra_languages"],
        "languages": ["ru", "en", "ar"],
        "preset": "tiffany_night",
        "sort_order": 20,
    },
    {
        "code": "blank",
        "title": {"ru": "С нуля", "en": "From scratch", "ar": "من الصفر", "zh": "从零开始"},
        "description": {"ru": "Пустой отель: сервисы заводит сам.",
                        "en": "An empty hotel: it adds services itself.",
                        "ar": "فندق فارغ: يضيف خدماته بنفسه.",
                        "zh": "空白酒店：由酒店自行添加服务。"},
        "tariff": "standard",
        "services": [],
        "modules": [],
        "languages": ["ru", "en"],
        "preset": "midnight_navy",
        "sort_order": 30,
    },
]


def ensure_seed() -> None:
    """Идемпотентно наполнить пустые реестры платформы. Существующее не трогаем."""
    from apps.catalog.vocabularies import ALLERGENS, DIETARY_MARKERS

    for entry in SEED_TEMPLATES:
        OnboardingTemplate.objects.get_or_create(code=entry["code"], defaults=entry)

    for kind, source in (
        (SystemDictionaryEntry.Kind.ALLERGEN, ALLERGENS),
        (SystemDictionaryEntry.Kind.MARKER, DIETARY_MARKERS),
    ):
        for order, entry in enumerate(source):
            SystemDictionaryEntry.objects.get_or_create(
                kind=kind,
                code=entry["code"],
                defaults={"title": entry["title"], "sort_order": order},
            )


# --- Применение шаблона ----------------------------------------------------


def serialize_template(template: OnboardingTemplate) -> dict:
    return {
        "id": str(template.pk),
        "code": template.code,
        "title": template.title,
        "description": template.description,
        "tariff": template.tariff,
        "services": template.services,
        "modules": template.modules,
        "languages": template.languages,
        "preset": template.preset,
        "is_active": template.is_active,
        "sort_order": template.sort_order,
    }


def list_templates(*, active_only: bool = False) -> list[dict]:
    queryset = OnboardingTemplate.objects.all()
    if active_only:
        queryset = queryset.filter(is_active=True)
    return [serialize_template(template) for template in queryset]


def get_template(code: str) -> OnboardingTemplate:
    template = OnboardingTemplate.objects.filter(code=code, is_active=True).first()
    if template is None:
        raise NotFoundError(f"Шаблон «{code}» не найден")
    return template


@transaction.atomic
def apply_template(hotel: Hotel, template: OnboardingTemplate) -> list[Service]:
    """
    Развернуть шаблон в уже заведённом отеле.

    Идёт ПОСЛЕ провижининга, а не внутри него: провижининг обязан создавать
    работоспособный отель сам по себе (им пользуются сид и CLI), а шаблон —
    это удобство поверх, и его отказ не должен оставлять полу-созданный отель.
    """
    from apps.core.context import tenant_context
    from apps.hotels.module_registry import set_modules

    created: list[Service] = []
    with tenant_context(hotel):
        for index, entry in enumerate(template.services or []):
            service_type = entry.get("type") or Service.Type.CUSTOM
            name = entry.get("name") or {}
            code = _slug(name.get("en") or name.get("ru") or service_type, index)
            if Service.objects.filter(code=code).exists():
                continue
            point = ExecutionPoint.objects.create(code=f"{code}-point", title=name or {"ru": code})
            created.append(
                Service.objects.create(
                    code=code,
                    type=service_type,
                    execution_point=point,
                    public_name=name,
                    is_guest_facing=True,
                )
            )

    if template.tariff:
        hotel.tariff = template.tariff
        hotel.save(update_fields=["tariff", "updated_at"])
    if template.modules:
        set_modules(hotel, [{"code": code, "is_enabled": True} for code in template.modules])
    return created


def _slug(source: str, index: int) -> str:
    from django.utils.text import slugify

    base = slugify(source) or f"service-{index + 1}"
    return base[:60]


# --- Системный справочник --------------------------------------------------


def list_dictionary(kind: str | None = None) -> list[dict]:
    queryset = SystemDictionaryEntry.objects.all()
    if kind:
        queryset = queryset.filter(kind=kind)
    return [
        {
            "id": str(entry.pk),
            "kind": entry.kind,
            "code": entry.code,
            "title": entry.title,
            "is_active": entry.is_active,
            "sort_order": entry.sort_order,
        }
        for entry in queryset
    ]


def upsert_dictionary_entry(*, kind: str, code: str, title: dict, is_active: bool = True) -> SystemDictionaryEntry:
    if kind not in SystemDictionaryEntry.Kind.values:
        raise ValidationError(f"Неизвестный вид справочника «{kind}»", field="kind")
    code = (code or "").strip().lower()
    if not code:
        raise ValidationError("Нужен код записи", field="code")
    if not title:
        raise ValidationError("Нужно название", field="title")

    entry, _ = SystemDictionaryEntry.objects.update_or_create(
        kind=kind,
        code=code,
        defaults={"title": title, "is_active": is_active},
    )
    return entry
