"""
Заказы.

Два инварианта, ради которых всё и строилось:

  1. Снапшоты. В OrderItem лежат цена, название и модификаторы НА МОМЕНТ
     заказа. Меню меняется каждый день — история заказа меняться не должна.
  2. Резолвленный маршрут. Order.execution_point вычисляется при создании и
     дальше не пересчитывается: перенастройка Route не должна переносить
     вчерашние заказы на другую кухню.
"""

from __future__ import annotations

from django.db import models

from apps.core.fields import TranslatableField
from apps.core.models import TenantModel

from .status import StatusDefinition


class Order(TenantModel):
    class Type(models.TextChoices):
        CART = "cart", "Корзина (несколько позиций)"
        REQUEST = "request", "Заявка (одно действие)"

    class DeliveryMode(models.TextChoices):
        DELIVERY = "delivery", "Доставка"
        PICKUP = "pickup", "Самовывоз"

    number = models.PositiveIntegerField(help_text="Сквозной номер в рамках отеля")
    type = models.CharField(max_length=16, choices=Type.choices, default=Type.CART)

    # Разъезд заказа (R2): у заказа-агрегатора (рум-сервис с заимствованным
    # контентом от разных исполнителей) появляются дочерние заказы — по одному
    # на исполнителя. parent = гостевой агрегат (снимок сумм, канал гостя,
    # статус-свод), children = исполнение (каждый на своей доске трекера).
    # Обычный заказ (один исполнитель) — parent=None и без children, как раньше.
    parent = models.ForeignKey(
        "self", on_delete=models.CASCADE, null=True, blank=True, related_name="children"
    )

    # КТО ОФОРМИЛ ЗА ГОСТЯ. Пусто — гость сам (или сев). Заполнено — сотрудник
    # ресепшена оформил из чата: гость видит пометку «оформил ресепшен», иначе
    # чужой заказ в своём списке читается как взлом.
    placed_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    guest_session = models.ForeignKey(
        "accounts.GuestSession",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="orders",
    )
    room = models.ForeignKey(
        "hotels.Room", on_delete=models.SET_NULL, null=True, blank=True, related_name="orders"
    )
    execution_point = models.ForeignKey(
        "hotels.ExecutionPoint",
        on_delete=models.PROTECT,
        related_name="orders",
    )
    location = models.ForeignKey(
        "hotels.Location", on_delete=models.SET_NULL, null=True, blank=True, related_name="orders"
    )
    location_refinement = models.CharField(
        max_length=128, blank=True, help_text="Шезлонг №, столик № и т.п."
    )
    delivery_mode = models.CharField(
        max_length=16, choices=DeliveryMode.choices, default=DeliveryMode.DELIVERY
    )
    requested_time = models.DateTimeField(
        null=True, blank=True, help_text="«К 19:00» — хранится в UTC, показывается в TZ отеля"
    )
    comment = models.TextField(blank=True)

    status = models.ForeignKey(
        StatusDefinition, on_delete=models.PROTECT, related_name="orders"
    )
    # null — у позиции нет цены (заявка-услуга без прайса). Ноль означал бы
    # «бесплатно», а это другое утверждение.
    total = models.IntegerField(
        null=True, blank=True, default=0, help_text="Итог к показу, в минимальных единицах"
    )
    currency = models.CharField(max_length=3, default="RUB")

    # --- Снимок начислений ---
    # Фиксируется при оформлении, как цены/модификаторы в OrderItem: отель
    # поменял сбор — старые заказы не меняются. `charges` хранит ставки/флаги
    # на момент оформления (аудит). Пока коммерция выключена, всё по нулям и
    # total == subtotal.
    subtotal_minor = models.IntegerField(default=0)
    service_fee_minor = models.IntegerField(default=0)
    tax_minor = models.IntegerField(default=0)
    delivery_fee_minor = models.IntegerField(default=0)
    tip_minor = models.IntegerField(default=0)
    charges = models.JSONField(default=dict, blank=True)

    # Снимок ответов на поля заявки-услуги. Пуст у обычного заказа с корзиной.
    # Именно снимок: заявка обязана пережить переименование и удаление полей
    # в CMS — исполнитель должен видеть, о чём его просили.
    field_values = models.JSONField(default=list, blank=True)

    # Кто взял заказ в работу. Отдельным полем, а не выводом из истории
    # переходов: доска показывает исполнителя в каждой карточке, и считать его
    # каждый раз из OrderStatusChange было бы и дорого, и неоднозначно.
    assignee = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="assigned_orders",
    )
    accepted_at = models.DateTimeField(null=True, blank=True)

    # ПОРОГ ПРОСРОЧКИ — СНИМКОМ НА МОМЕНТ ЗАКАЗА. По нему судят закрытый заказ
    # («был ли он просрочен»): смена настройки точки не должна переписывать
    # прошлое — заказ, бывший вовремя, не становится просроченным задним
    # числом. Живая доска считает по текущей настройке точки: это настоящее.
    # У заказов до волны 8 — настройка на момент миграции (раньше не хранили).
    sla_minutes = models.PositiveSmallIntegerField(null=True, blank=True)

    # --- Закрытие, переоткрытие и место на доске ----------------------------

    # КОГДА ЗАКРЫТ — ОДИН ОТВЕТ НА ВЕСЬ ПРОДУКТ.
    #
    # Раньше момент закрытия вычисляли из журнала переходов, и вычисляли
    # ПО-РАЗНОМУ: сводка смены брала ПЕРВОЕ попадание в терминал, аналитика —
    # ПОСЛЕДНЕЕ. Пока откатов не было, разница пряталась; с ними две половины
    # продукта расходились бы на глазах. Теперь у вопроса одно место.
    #
    # Ставится при первом уходе в терминал (в том числе в отмену — это тоже
    # закрытие) и НЕ ПЕРЕЗАПИСЫВАЕТСЯ при повторном: заказ закрывается один раз,
    # даже если его успели вернуть и закрыть снова.
    class CancelReason(models.TextChoices):
        """
        ПОЧЕМУ СПРАВОЧНИК, А НЕ СВОБОДНЫЙ ТЕКСТ.

        Поле для причины было и раньше — `OrderStatusChange.comment`, 255
        символов. Замер на стенде: отменённых заказов 912, записей об отмене в
        журнале 125, и НИ ОДНОЙ с заполненной причиной. Свободный текст,
        который никто не обязан заполнять, не заполняется никогда.

        Но и один справочник не годится: любой конечный список заставляет
        выбирать «прочее» там, где случай не подошёл, и тогда мы снова ничего
        не знаем. Поэтому код ОБЯЗАТЕЛЕН (по нему считают: сколько отмен из-за
        стоп-листа, сколько по вине гостя), а уточнение текстом — по желанию,
        и живёт в журнале рядом с тем, кто и когда отменил.

        Набор короткий намеренно: длинный список выбирают не читая.
        """

        OUT_OF_STOCK = "out_of_stock", "Нет в наличии"
        GUEST_REFUSED = "guest_refused", "Гость отказался"
        NO_CAPACITY = "no_capacity", "Некому выполнить"
        DUPLICATE = "duplicate", "Дубль заявки"
        MISTAKE = "mistake", "Ошиблись при оформлении"
        OTHER = "other", "Другое"

    # Причина отмены — КОД из справочника выше. Пусто у всего, что не отменено,
    # и у 787 заказов, отменённых до этой партии командой обслуживания мимо
    # журнала: выдумывать им причину нечем.
    cancel_reason = models.CharField(
        max_length=32, choices=CancelReason.choices, blank=True
    )

    closed_at = models.DateTimeField(null=True, blank=True, db_index=True)

    # КОГДА ВЕРНУЛИ В РАБОТУ. Нужен просрочке: заказ, закрытый через два часа и
    # возвращённый, иначе мгновенно становится красным «просрочка 100 минут» —
    # отсчёт-то идёт от создания. Полем, а не вычислением из журнала: журнал уже
    # однажды дал два разных ответа на «когда закрыт», второго такого источника
    # правды не заводим.
    reopened_at = models.DateTimeField(null=True, blank=True)

    # МЕСТО В КОЛОНКЕ — ОБЩЕЕ ДЛЯ ВСЕЙ СМЕНЫ, а не личное.
    #
    # Дробное, потому что вставка между соседями — это середина между их
    # позициями, без переписывания всей колонки. Начальные значения —
    # время создания в секундах эпохи: так порядок сразу совпадает с тем, в
    # котором доска жила до ручного порядка.
    board_position = models.FloatField(default=0.0)

    # Швы под будущее: оплату и PMS пока не реализуем.
    payment_state = models.CharField(max_length=32, default="none")
    pms_folio_ref = models.CharField(max_length=128, blank=True)

    class Meta:
        db_table = "orders_order"
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "number"], name="uniq_order_number_per_hotel"
            )
        ]
        indexes = [
            models.Index(fields=["hotel", "execution_point", "-created_at"]),
            models.Index(fields=["hotel", "status"]),
            models.Index(fields=["hotel", "parent"]),
            # Доска активной смены: колонка сортируется местом, а время создания
            # разводит совпадения.
            models.Index(
                fields=["hotel", "execution_point", "board_position", "created_at"],
                name="ix_order_board_position",
            ),
            # История: она листается по моменту закрытия, а не создания.
            models.Index(fields=["hotel", "execution_point", "-closed_at"], name="ix_order_closed"),
        ]

    def __str__(self) -> str:
        return f"#{self.number}"

    @property
    def realtime_group(self) -> str:
        """Канал, на который подписан гость, чтобы видеть статус своего заказа."""
        return f"order.{self.hotel_id}.{self.pk}"


class OrderItem(TenantModel):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="items")
    item = models.ForeignKey(
        "catalog.Item", on_delete=models.PROTECT, related_name="order_items"
    )
    quantity = models.PositiveSmallIntegerField(default=1)

    # Снапшоты: не выводить их из связанных объектов при чтении заказа.
    title_snapshot = TranslatableField()
    unit_price_snapshot = models.IntegerField(null=True, blank=True, default=0)
    modifiers_snapshot = models.JSONField(default=list, blank=True)
    line_total = models.IntegerField(null=True, blank=True, default=0)
    comment = models.CharField(max_length=255, blank=True)

    class Meta:
        db_table = "orders_order_item"
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"{self.item_id} ×{self.quantity}"
