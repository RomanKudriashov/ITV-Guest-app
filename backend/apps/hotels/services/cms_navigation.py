"""
Навигация CMS: что отель видит в своей панели.

До R4 меню было плоской простынёй из 16 пунктов, одинаковой у всех отелей, и
реестр модулей (R1) ни на что не влиял. Здесь навигация становится данными:
сервер отдаёт группы и пункты, клиент их рисует.

**Почему навигация приходит с сервера.** Гейтинг решает реестр модулей, который
живёт на бэкенде; собери меню на клиенте — и список того, за что отель не
платил, всё равно уедет к нему в бандл, а «спрятать пункт» превратится в
косметику поверх открытого экрана.

**Главное правило гейтинга: базовое не гейтится.** Модуль — это платная
надстройка, а не выключатель для того, без чего отель не работает. Меню,
номера, персонал, бренд, аналитика и настройки есть у всех и не привязаны ни к
какому модулю. Привязка базового пункта к модулю выглядит как «настройка», а на
деле оставляет отель без инструмента, за который он уже заплатил тарифом.

Поэтому `module` проставлен ровно у тех пунктов, которые БЕЗ модуля не имеют
смысла: экран управления номером бессмыслен без GRMS, экран оплаты — без
платёжного модуля. Остальные пункты живут всегда.
"""

from __future__ import annotations

import dataclasses

from apps.hotels.models import HotelModule


@dataclasses.dataclass(frozen=True, slots=True)
class NavItem:
    key: str
    to: str
    # Код модуля, без которого пункта нет. None = базовый пункт, есть всегда.
    module: str | None = None
    # Пункт виден только администратору отеля (не управляющему сервисом).
    hotel_admin_only: bool = False


@dataclasses.dataclass(frozen=True, slots=True)
class NavGroup:
    key: str
    items: tuple[NavItem, ...]


# Группы карты продукта. Порядок здесь — порядок на экране.
#
# ГРУППА «МОДУЛИ» РАСТВОРЕНА, и это главное изменение раскладки.
#
# Она группировала пункты по СПОСОБУ ПРОДАЖИ, а не по предмету: «Оплата»,
# «Управление номером» и «Маркетинг» лежали вместе только потому, что за них
# доплачивают. Админ, которому нужна оплата, думает «настройки», а не «за что
# мы платим», и шёл искать её не туда. Заодно было две группы из ОДНОГО пункта
# («Оформление», «Аналитика»): заголовок обязан сокращать перебор, а над
# единственной строкой он его удваивает.
#
# Теперь каждый модульный экран лежит там, где его предмет: управление номером —
# к структуре отеля (это про номер), маркетинг — к витрине (это про то, что
# видит гость), оплата, PMS и мобильный ключ — к настройкам.
#
# ГЕЙТИНГ ОТ ЭТОГО НЕ ИЗМЕНИЛСЯ НИ НА ШАГ: `module` остался у тех же пунктов,
# и без включённого модуля пункт по-прежнему не приходит с сервера. Изменилось
# только МЕСТО пункта, а место не обязано зависеть от прайса.
NAVIGATION: tuple[NavGroup, ...] = (
    NavGroup(
        key="operations",
        items=(
            NavItem(key="dashboard", to="/cms/dashboard"),
            # Трекер живёт вне /cms (свой мобильный шелл), но найти его надо
            # отсюда: после одного входа сотрудник обязан найти обе половины.
            NavItem(key="tracker", to="/tracker"),
            # Уведомления переехали из «Настроек»: это оперативный экран, на
            # него смотрят в смену, а не настраивают раз и забывают.
            NavItem(key="notifications", to="/cms/notifications"),
        ),
    ),
    NavGroup(
        key="structure",
        items=(
            NavItem(key="services", to="/cms/services"),
            NavItem(key="rooms", to="/cms/rooms", hotel_admin_only=True),
            NavItem(key="staff", to="/cms/staff"),
            NavItem(
                key="roomControl",
                to="/cms/room-control",
                module=HotelModule.Code.ROOM_CONTROL,
                hotel_admin_only=True,
            ),
        ),
    ),
    NavGroup(
        key="storefront",
        # Всё, что отвечает на вопрос «что видит гость и что из этого вышло»:
        # оформление, акции и цифры по ним. Бренд и витрина при этом остаются
        # ОДНИМ пунктом — разводить их значило бы заставлять админа держать
        # соответствие в голове.
        items=(
            NavItem(key="brand", to="/cms/brand", hotel_admin_only=True),
            NavItem(
                key="marketing",
                to="/cms/marketing",
                module=HotelModule.Code.MARKETING,
                hotel_admin_only=True,
            ),
            NavItem(key="analytics", to="/cms/analytics"),
        ),
    ),
    NavGroup(
        key="settings",
        # То, что настраивают редко: параметры отеля, справочники и внешние
        # системы. Интеграции здесь не «модули», а именно настройка стыка.
        items=(
            NavItem(key="settings", to="/cms/settings", hotel_admin_only=True),
            NavItem(key="dictionaries", to="/cms/dictionaries", hotel_admin_only=True),
            NavItem(
                key="payments",
                to="/cms/payments",
                module=HotelModule.Code.PAYMENT,
                hotel_admin_only=True,
            ),
            NavItem(
                key="pms",
                to="/cms/pms",
                module=HotelModule.Code.PMS,
                hotel_admin_only=True,
            ),
            NavItem(
                key="mobileKey",
                to="/cms/mobile-key",
                module=HotelModule.Code.MOBILE_KEY,
                hotel_admin_only=True,
            ),
        ),
    ),
)

# Пункты, которые НИКОГДА не гейтятся модулем, — сторож против случайной
# привязки базового экрана к платной фиче. Проверяется тестом.
ALWAYS_AVAILABLE = frozenset(
    {"dashboard", "tracker", "services", "rooms", "staff", "brand",
     "analytics", "settings", "notifications", "dictionaries"}
)


def build_navigation(hotel, *, access) -> list[dict]:
    """
    Навигация для конкретного отеля и конкретной роли.

    Пустые группы не отдаём: заголовок без пунктов — это шум, по которому
    админ решает, что что-то сломалось.
    """
    from apps.hotels.module_registry import enabled_module_codes

    enabled = enabled_module_codes(hotel)

    groups = []
    for group in NAVIGATION:
        items = [
            {"key": item.key, "to": item.to, "module": item.module}
            for item in group.items
            if (item.module is None or item.module in enabled)
            and (not item.hotel_admin_only or access.unrestricted)
        ]
        if items:
            groups.append({"key": group.key, "items": items})
    return groups
