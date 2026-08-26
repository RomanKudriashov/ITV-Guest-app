"""
Группы отелей: адрес для массовых действий платформы.

ЗАЧЕМ. Флот режется поиском, статусом, тарифом и происхождением — и всё. «Сеть
Radisson», «Москва», «тестовые», «участники осенней кампании» выразить нечем, а
именно им адресуются массовые действия, публикация контента и реклама.

ЧЕТЫРЕ РЕШЕНИЯ, КОТОРЫЕ ЗДЕСЬ ЗАФИКСИРОВАНЫ.

1. ОТЕЛЬ В НЕСКОЛЬКИХ ГРУППАХ. Сеть, город, «тестовые» и кампания — четыре
   независимых разреза одного отеля. Одна группа на отель означала бы, что
   кампания вытесняет сеть.

2. ВЛОЖЕННОСТИ НЕТ. Дерево «сеть → бренд → город» немедленно задаёт вопрос
   «действие на узле — это действие на потомках?», и любой ответ будет неверным
   для половины случаев. Вместо дерева — ТИП группы и пересечение при выборе:
   «сеть Radisson и город Москва» решает те же задачи и читается однозначно.

3. ГРУППЫ ЗАВОДИМ МЫ, ОТЕЛЬ О НИХ НЕ ЗНАЕТ. Это инструмент платформы: наши
   массовые действия и наша реклама. Поэтому модель НЕ ТЕНАНТНАЯ и живёт рядом
   с `Hotel`, а не внутри отеля; в CMS отеля групп нет ни на одном экране.

4. ДВА ВИДА. Список — сложили руками. Правило — условие («город Москва»,
   «демонстрационные»), которое ПЕРЕСЧИТЫВАЕТСЯ В МОМЕНТ ДЕЙСТВИЯ. Правило,
   помнящее старый состав, — это список, притворяющийся правилом: заведённый
   вчера московский отель обязан попадать под «город Москва» сам, иначе
   человек будет пересобирать группу руками и однажды забудет.
"""

from __future__ import annotations

from django.db import models

from apps.core.models import BaseModel


class HotelGroup(BaseModel):
    """
    Группа отелей. Не тенантная: живёт на уровне платформы, как и `Hotel`.

    НАЗВАНИЕ НЕ ПЕРЕВОДИМОЕ, в отличие от названия отеля. Группу видим только
    мы, и пишет её наш оператор на своём языке: «Сеть Radisson» переводить
    некому и незачем, а `TranslatableField` заставил бы заполнять четыре формы
    ради внутренней метки.
    """

    class Kind(models.TextChoices):
        NETWORK = "network", "Сеть"
        BRAND = "brand", "Бренд"
        CITY = "city", "Город"
        TEST = "test", "Тестовые"
        CAMPAIGN = "campaign", "Кампания"
        CUSTOM = "custom", "Своя"

    class Mode(models.TextChoices):
        # Состав сложен руками и хранится строками членства.
        LIST = "list", "Список"
        # Состав ВЫЧИСЛЯЕТСЯ правилом каждый раз, когда его спрашивают.
        RULE = "rule", "Правило"

    code = models.SlugField(max_length=64, unique=True)
    title = models.CharField(max_length=200)
    kind = models.CharField(max_length=16, choices=Kind.choices, default=Kind.CUSTOM)
    mode = models.CharField(max_length=8, choices=Mode.choices, default=Mode.LIST)

    # Условие для `mode=rule`: {"city": "Москва", "origin": "demo", "tariff": "business"}.
    # Пустые ключи не участвуют. Хранится JSON, а не колонки: набор признаков
    # будет расти (страна, дата заведения), и каждая новая колонка означала бы
    # миграцию ради фильтра.
    rule = models.JSONField(default=dict, blank=True)

    note = models.TextField(blank=True)

    class Meta:
        db_table = "hotels_group"
        ordering = ["kind", "title"]

    def __str__(self) -> str:
        return f"group:{self.code}"

    @property
    def is_rule(self) -> bool:
        return self.mode == self.Mode.RULE


class HotelGroupMember(BaseModel):
    """
    Членство в группе-СПИСКЕ. Для групп-правил строк здесь нет вовсе.

    Хранится «кто и когда добавил»: состав группы — это решение человека, и на
    вопрос «почему этот отель в кампании» должен отвечать журнал, а не память
    того, кто его туда положил. `added_by` — UUID нашего оператора, без FK:
    строка обязана пережить удаление учётной записи.
    """

    group = models.ForeignKey(HotelGroup, on_delete=models.CASCADE, related_name="members")
    hotel = models.ForeignKey("hotels.Hotel", on_delete=models.CASCADE, related_name="group_links")
    added_by = models.UUIDField(null=True, blank=True)

    class Meta:
        db_table = "hotels_group_member"
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["group", "hotel"], name="uniq_group_hotel")
        ]

    def __str__(self) -> str:
        return f"group:{self.group_id}+hotel:{self.hotel_id}"


class PlatformScopeGroup(BaseModel):
    """
    Область члена команды платформы: к каким группам отелей он имеет отношение.

    ВТОРАЯ ОСЬ рядом с правом, а не новая роль (`services/platform/scope.py`).
    Строк нет — ограничения нет, то есть весь флот: ни одна существующая учётка
    не меняет смысла от появления этой таблицы.

    Не тенантная, как и сами группы: это устройство нашей команды, и отель о
    нём не знает.
    """

    # UUID, А НЕ ВНЕШНИЙ КЛЮЧ — по устройству базы, а не для гибкости.
    # `accounts_user` тенантная и под RLS, а наша учётка живёт с `hotel_id =
    # NULL` и видна только платформенной роли. Внешний ключ на неё роль
    # приложения проверить не может: вставка падает «ключа нет в таблице», хотя
    # строка есть. Целостность здесь держит удаление члена команды, а не СУБД.
    user_id = models.UUIDField(db_index=True)
    group = models.ForeignKey(HotelGroup, on_delete=models.CASCADE, related_name="scoped_users")

    class Meta:
        db_table = "hotels_platform_scope_group"
        ordering = ["user_id"]
        constraints = [
            models.UniqueConstraint(fields=["user_id", "group"], name="uniq_platform_scope")
        ]

    def __str__(self) -> str:
        return f"scope:{self.user_id}+{self.group_id}"
