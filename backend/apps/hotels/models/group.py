"""
Группы отелей: отели одного владельца (партия 62-A1).

ЗАЧЕМ. «Отели Метрополь», «Демо-отели» — владелец нескольких отелей, у которых
общий администратор, общие справочники и сводка. Группой же адресуются
массовые действия и публикации, и на группах держится область сотрудника
платформы (`PlatformScopeGroup`).

РЕШЕНИЯ (Олег, партия 62; прежние — «отель в нескольких группах» и
«группы-правила» — сняты):

1. ОТЕЛЬ — МАКСИМУМ В ОДНОЙ ГРУППЕ. Группа — владелец, а у отеля один
   владелец. Уникальность — в базе, среди живых строк членства.

2. ТОЛЬКО СПИСОК. Состав складывают руками; правило «город Москва» убрано —
   миграция 0046 перевела правила в списки по составу на момент перехода.

3. ВЛОЖЕННОСТЬ ЗАЛОЖЕНА, НО НЕ ИСПОЛЬЗУЕТСЯ. `parent` есть в модели,
   интерфейс показывает один уровень; действия на родителе потомков не
   касаются, пока это не решено отдельно.

4. ГРУППЫ ЗАВОДИМ МЫ, ОТЕЛЬ О НИХ НЕ ЗНАЕТ. Модель не тенантная и живёт рядом
   с `Hotel`; в CMS отеля групп нет ни на одном экране.
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

    class Color(models.TextChoices):
        # Метка в списке отелей — из состояний темы консоли, а не произвольный
        # цвет: в обеих темах читается и не спорит со смыслом пилюль.
        ACCENT = "accent", "Синий"
        OK = "ok", "Зелёный"
        WARN = "warn", "Янтарный"
        BAD = "bad", "Красный"
        GOLD = "gold", "Золотой"
        INFO = "info", "Голубой"

    # Код — внутренний (адреса, журнал); человек его не видит и не вводит:
    # при создании он выводится из названия.
    code = models.SlugField(max_length=64, unique=True)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    color = models.CharField(max_length=16, choices=Color.choices, default=Color.ACCENT)
    sort_order = models.PositiveIntegerField(default=0)
    parent = models.ForeignKey("self", on_delete=models.SET_NULL, null=True, blank=True, related_name="children")

    # Заметка для нашей команды: договорённости, контакты, особенности.
    note = models.TextField(blank=True)

    class Meta:
        db_table = "hotels_group"
        ordering = ["sort_order", "title"]

    def __str__(self) -> str:
        return f"group:{self.code}"


class HotelGroupMember(BaseModel):
    """
    Членство отеля в группе. Отель — максимум в одной группе (среди живых строк).

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
            models.UniqueConstraint(fields=["group", "hotel"], name="uniq_group_hotel"),
            # Один владелец у отеля (партия 62-A1).
            models.UniqueConstraint(
                fields=["hotel"],
                condition=models.Q(deleted_at__isnull=True),
                name="uniq_hotel_one_group",
            ),
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
