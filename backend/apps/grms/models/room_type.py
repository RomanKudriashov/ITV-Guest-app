"""
Тип номера и привязка к нему конкретных комнат.
"""

from __future__ import annotations

from django.db import models

from apps.core.fields import TranslatableField
from apps.core.models import TenantModel


class RoomType(TenantModel):
    """
    Тип номера — номера с одинаковым составом оборудования (ТЗ §10).

    Все номера типа получают ОДИН интерфейс, но обращаются к РАЗНЫМ устройствам
    iRidi. Настраивается тип один раз, а не 200 раз по числу комнат.

    Прозвон это подтверждает: у ТИП2 (708) и ТИП3 (706) наборы тегов
    различаются (2 шторы против 3), а внутри типа одинаковы.
    """

    code = models.SlugField(max_length=64)
    title = TranslatableField()

    # Шаблон имени устройства iRidi. Единственная подстановка — {room},
    # номер комнаты: «Modbus TCP Server (Slave mode) {room}». Выражений и
    # функций в шаблоне нет намеренно — это поле правит администратор объекта.
    #
    # Шаблон ПРЕДЛАГАЕТСЯ системой, но подтверждается администратором (ТЗ §10),
    # а не применяется молча: опечатка здесь означает команды не в тот номер.
    device_name_template = models.CharField(max_length=255, blank=True)

    # На этом объекте всегда пусто. "Custom" из примеров ТЗ и Postman на боевом
    # сервере ЛОМАЕТ чтение: скрипт склеивает тег как subdevice + ":" + feedback
    # и ищет несуществующий «Custom:F_DND» (см. iridi-probe.md §8.1).
    # Поле оставлено на случай другого объекта.
    subdevice = models.CharField(max_length=128, blank=True)

    notes = models.TextField(blank=True)

    # Геометрия плана-двойника: рендер номера и разметка зон, окон и точек в
    # ПРОЦЕНТАХ от кадра. Форма — apps/grms/plan.py, источник демо-значений —
    # docs/design/grms-concept/plan-geometry.json.
    #
    # Это ЧЕРНОВИК, как и элементы: гость видит не его, а копию, попавшую в
    # опубликованный снимок. Иначе правка разметки уезжала бы в номер мимо
    # публикации, а откат конфигурации возвращал бы старые элементы с новой
    # разметкой — то есть точки управления не там, где оборудование.
    #
    # Пусто — у типа нет плана. Это штатный случай: экран работает списком.
    plan = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "grms_room_type"
        ordering = ["code"]
        constraints = [
            models.UniqueConstraint(fields=["hotel", "code"], name="uniq_grms_room_type_per_hotel")
        ]

    def __str__(self) -> str:
        return self.code

class RoomTypeRoom(TenantModel):
    """
    Связь «комната ↔ тип номера».

    Отдельной таблицей, а не полем на hotels.Room, сознательно:
      * hotels не начинает зависеть от grms — направление остаётся grms → hotels,
        миграции не переплетаются;
      * появляется естественное место для переопределения имени устройства на
        комнату (ТЗ §10) — оно принадлежит именно связи, а не комнате и не типу;
      * модуль снимается целиком, не оставляя мёртвой колонки в hotels_room.

    Комната относится максимум к одному типу — отсюда OneToOne.
    """

    room = models.OneToOneField(
        "hotels.Room", on_delete=models.CASCADE, related_name="grms_type_link"
    )
    room_type = models.ForeignKey(RoomType, on_delete=models.CASCADE, related_name="rooms")

    # Эталонная комната типа: на ней администратор прогоняет конфигурацию до
    # публикации (ТЗ §11). Единственный момент, когда команда уходит в номер
    # не от гостя.
    is_reference = models.BooleanField(default=False)

    # Полностью заменяет результат шаблона, если задано. Реальные объекты не
    # бывают идеально регулярными: одна комната после переделки может
    # называться иначе, и из-за неё менять шаблон всего типа нельзя.
    device_name_override = models.CharField(max_length=255, blank=True)

    class Meta:
        db_table = "grms_room_type_room"
        ordering = ["room_id"]
        constraints = [
            models.UniqueConstraint(fields=["hotel", "room"], name="uniq_grms_room_link_per_hotel")
        ]

    def __str__(self) -> str:
        return f"{self.room_id} → {self.room_type_id}"
