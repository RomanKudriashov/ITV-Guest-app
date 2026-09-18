"""
ЧТО ПЕРЕВОДИМ — один список на весь механизм.

Сюда входит ТОЛЬКО ТО, ЧТО ЧИТАЕТ ГОСТЬ, и список собран сверкой со всеми
переводимыми полями проекта, а не на глаз. Что осталось снаружи и почему:

  hotels.Hotel.name / .city        имя собственное и справочник геокодера
                                   (город приезжает переведённым, волна 10 п. 22);
  hotels.ExecutionPoint.title      «кухня», «бар» — читает смена, не гость;
  hotels.RoomCategory.title        живёт только в CMS: правила и отчёты;
  grms.RoomType.title              конфигурация номера, гостю не показывается;
  hotels.OnboardingTemplate,
  hotels.SystemDictionaryEntry     платформенные справочники: не отель их правит;
  orders.OrderItem.title_snapshot  снимок заказа — историческая правда, менять
                                   её задним числом нельзя НИКОГДА;
  media.MediaAsset.alt             поле есть, но витрина его пока не отдаёт:
                                   переводить нечего, пока некому читать.

Статусы заказа переводим: их названия гость видит в своём заказе
(«Готово к выдаче», «В пути»), это не служебная подпись.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FieldSpec:
    """Поле одной модели: что показывать в отчёте и как искать записи."""

    app_label: str
    model: str
    field: str
    title: str
    # Короткое имя группы для отчёта: «позиции», «разделы», «заведения».
    group: str


FIELDS: tuple[FieldSpec, ...] = (
    FieldSpec("hotels", "Service", "public_name", "Название заведения", "заведения"),
    FieldSpec("hotels", "Service", "tagline", "Подпись заведения", "заведения"),
    FieldSpec("catalog", "Category", "title", "Название раздела", "разделы"),
    FieldSpec("catalog", "Category", "description", "Описание раздела", "разделы"),
    FieldSpec("catalog", "Item", "title", "Название позиции", "позиции"),
    FieldSpec("catalog", "Item", "description", "Описание позиции", "позиции"),
    FieldSpec("catalog", "Item", "content", "Текст инфо-страницы", "позиции"),
    FieldSpec("catalog", "ItemCharacteristic", "name", "Характеристика: название", "позиции"),
    FieldSpec("catalog", "ItemCharacteristic", "value", "Характеристика: значение", "позиции"),
    FieldSpec("catalog", "ModifierGroup", "title", "Группа модификаторов", "модификаторы"),
    FieldSpec("catalog", "ModifierOption", "title", "Вариант модификатора", "модификаторы"),
    FieldSpec("catalog", "RequestField", "label", "Поле заявки", "заявки"),
    FieldSpec("catalog", "RequestField", "help_text", "Подсказка поля заявки", "заявки"),
    FieldSpec("catalog", "Badge", "label", "Метка", "метки"),
    FieldSpec("catalog", "Allergen", "title", "Аллерген", "справочники"),
    FieldSpec("catalog", "DietaryMarker", "title", "Диетический маркер", "справочники"),
    FieldSpec("hotels", "Location", "title", "Место получения", "места"),
    FieldSpec("hotels", "Location", "refinement_label", "Уточнение места", "места"),
    FieldSpec("orders", "StatusDefinition", "title", "Статус заказа", "статусы"),
    FieldSpec("orders", "StatusDefinition", "title_pickup", "Статус при самовывозе", "статусы"),
    FieldSpec("grms", "Zone", "title", "Зона номера", "управление номером"),
    FieldSpec("grms", "ControlElement", "title", "Элемент номера", "управление номером"),
    FieldSpec("grms", "ControlElement", "hint", "Подсказка элемента", "управление номером"),
)


def specs_for(groups: list[str] | None = None) -> tuple[FieldSpec, ...]:
    if not groups:
        return FIELDS
    wanted = set(groups)
    return tuple(spec for spec in FIELDS if spec.group in wanted)
