"""
Схемы каталога, видимые гостю.

Схемы объявлены ЗДЕСЬ, а не рядом со вьюхой: схема — это контракт домена, и
жить она должна там же, где модель и сервис, которые его исполняют. Пока
объявления лежали во вьюхах, один и тот же ресурс описывался в трёх местах, а
общее уезжало в общий `api/schemas.py`, куда сваливалось всё подряд.

Раскладка по ПОТРЕБИТЕЛЮ (guest / cms / platform / staff): у одного ресурса
разные права и разные поля наружу, и складывать их в один файл значит однажды
отдать гостю поле, которое собирали для оператора.
"""

from __future__ import annotations

from typing import Any

from ninja import Schema



class MenuOut(Schema):
    language: str | None
    server_time: str | None
    hero_image: str | None = None
    # Заполнен при скоупе на заведение: его имя, подпись, ТИП (по нему витрина
    # выбирает блок контента) и статус часов. None — общий каталог отеля.
    venue: dict[str, Any] | None = None
    categories: list[dict[str, Any]]

# Имя РАЗВЕДЕНО с одноимённой CMS-схемой (apps/catalog/schemas/cms.py).
# Компонент OpenAPI называется по имени класса, поэтому два разных класса с
# одним именем давали один компонент — и половина эндпоинтов была
# документирована чужим телом. Тела ответов при разведении не менялись.
class GuestItemDetailOut(Schema):
    id: str
    code: str
    type: str
    # Средняя яркость кадра (0..1). Витрина подбирает по ней плотность
    # затемнения под стеклянной панелью; `None` — кадра нет или он ещё не
    # обработан, и витрина возьмёт безопасное умолчание.
    image_luminance: float | None = None
    location_mode: str
    category_id: str
    category_title: str
    title: str
    description: str
    price: int | None
    images: list[str]
    # Аллергены/маркеры/характеристики — локализованные объекты; пустые не
    # приходят (карточка не рисует пустой блок).
    allergens: list[dict[str, Any]] = []
    markers: list[dict[str, Any]] = []
    characteristics: list[dict[str, Any]] = []
    nutrition: dict[str, Any] | None = None
    prep_minutes: int | None = None
    badges: list[dict[str, Any]] = []
    has_modifiers: bool
    has_required_modifiers: bool
    has_fields: bool
    has_content: bool = False
    has_slots: bool = False
    is_orderable: bool = True
    content: str = ""
    is_available: bool
    unavailable_reason: str | None
    available_from: str | None
    available_until: str | None
    # Момент следующего открытия целиком: витрине нужен ДЕНЬ, а не только час.
    # «с 07:00» в полдень читается как «сегодня в семь» — см. `availability.py`.
    available_at: str | None = None
    modifier_groups: list[dict[str, Any]]
    request_fields: list[dict[str, Any]]

class LocationsOut(Schema):
    room: str | None
    locations: list[dict[str, Any]]
    delivery_modes: list[str]
