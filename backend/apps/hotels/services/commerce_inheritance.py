"""
Коммерция сервиса поверх коммерции отеля — пара-оверрайд общего механизма.

ЗАЧЕМ ЭКРАН. Правило «пусто = наследовать отель» работало и до этого модуля:
его считает `Service.commerce_value()`. Не работало другое — УВИДЕТЬ, у кого
что задано. Ответ на вопрос «а почему у нас сбор не везде десять процентов»
собирался обходом карточек заведений по одной, и собирался неверно: заглянув в
шесть карточек из девяти, человек уходил с уверенностью, что везде одинаково.

Это деньги. Расхождение в сборе — это расхождение в счёте гостя, и узнавать о
нём из жалобы дороже, чем из списка.

ЧТО ЗДЕСЬ НЕ СЧИТАЕТСЯ ПАРОЙ.

  • `min_order_minor` — у отеля такого поля НЕТ. Минимальная сумма заказа
    существует только у сервиса, наследовать её не от чего, и показывать её
    как «своё значение» значило бы обещать источник, которого нет.
  • Налог, валюта и налоговый режим живут только на отеле: по карте продукта
    это свойство юридического лица, а не заведения.

Обе оговорки — про то, что пара должна иметь ДВЕ стороны. Поле, у которого
источника нет, в механизм не входит, сколько бы оно ни выглядело похоже.
"""

from __future__ import annotations

from apps.accounts.services.roles import require_hotel_admin
from apps.hotels.models import Hotel, Service
from apps.hotels.services import inheritance

#: Поля, у которых есть обе стороны: значение отеля и оверрайд сервиса.
FIELDS = (
    "service_fee_bp",
    "tip_presets",
    "free_delivery_threshold_minor",
    "price_round_to_minor",
)

#: Как поле называть человеку. Живёт здесь, а не на фронте, потому что тем же
#: списком пользуется отчёт; два списка разошлись бы на первом же поле.
LABELS = {
    "service_fee_bp": "сервисный сбор",
    "tip_presets": "подсказки чаевых",
    "free_delivery_threshold_minor": "порог бесплатной доставки",
    "price_round_to_minor": "округление итога",
}


def source_map(hotel: Hotel) -> dict[tuple, object]:
    """Значения отеля — источник для всех его сервисов."""
    return {(field,): getattr(hotel, field) for field in FIELDS}


def local_map(service: Service) -> dict[tuple, object]:
    """
    ТОЛЬКО заданные оверрайды сервиса.

    `None` выкидывается здесь — это «наследовать», а не значение. Разница между
    «не задано» и «задано нулём» существенна: нулевой сбор — это решение
    «в баре сбора нет», а не отсутствие решения.
    """
    return {
        (field,): getattr(service, field)
        for field in FIELDS
        if getattr(service, field) is not None
    }


def report(hotel: Hotel) -> dict:
    """
    Список: у кого из заведений своя коммерция и какая.

    Считается пересчётом по живым значениям. Сервисы без единого оверрайда в
    выдачу не попадают — экран отвечает на вопрос «где не как у отеля», а не
    «перечисли мне все заведения».
    """
    require_hotel_admin()

    source = source_map(hotel)
    rows = []
    for service in Service.objects.order_by("sort_order", "code"):
        divergences = inheritance.classify_overrides(source, local_map(service))
        if not divergences:
            continue
        counts = inheritance.summarize(divergences)
        rows.append(
            {
                "service_id": str(service.pk),
                "code": service.code,
                "name": service.public_title or {"ru": service.code},
                "counts": counts,
                "fields": [
                    {
                        "field": item.key[0],
                        "label": LABELS[item.key[0]],
                        "state": item.state.value,
                        "hotel": (item.source or {}).get("value"),
                        "own": (item.local or {}).get("value"),
                    }
                    for item in sorted(divergences, key=lambda d: FIELDS.index(d.key[0]))
                ],
            }
        )

    return {
        "hotel": {field: getattr(hotel, field) for field in FIELDS},
        "services": rows,
        # Заголовок экрана: «у 3 заведений из 9 своя коммерция».
        "with_own": len(rows),
        "total_services": Service.objects.count(),
    }


def reset(hotel: Hotel, service_ids: list[str], *, fields: list[str] | None = None) -> int:
    """
    Вернуть сервис к наследованию — ЯВНОЕ действие, по одному полю.

    Возврат здесь — это простановка `NULL`, а не копирование значения отеля.
    Скопировать значило бы закрепить его (`PINNED`) и оставить ровно ту же
    проблему под другим именем: сегодня совпадает, завтра отель правит своё,
    а сервис за ним не идёт.
    """
    require_hotel_admin()

    chosen = [field for field in (fields or FIELDS) if field in FIELDS]
    if not chosen:
        return 0

    changed = 0
    for service in Service.objects.filter(pk__in=service_ids):
        touched = [field for field in chosen if getattr(service, field) is not None]
        if not touched:
            continue
        for field in touched:
            setattr(service, field, None)
        service.save(update_fields=[*touched, "updated_at"])
        changed += len(touched)
    return changed
