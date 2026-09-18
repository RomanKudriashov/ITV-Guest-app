"""
Рекламный баннер на витрине и его статистика.

ПОЧЕМУ СВОИ ТАБЛИЦЫ, А НЕ ЖУРНАЛ АНАЛИТИКИ. `analytics_event` — источник
истины для дневных роллапов по заказам и сессиям. Положив туда показы и клики,
мы получили бы рекламу внутри витрины продаж: один неверный фильтр в редьюсере
— и баннер начинает считаться выручкой. Требование «баннер не попадает в
аналитику заказов как продажа» выполняется устройством, а не аккуратностью.

ОДНА СТРОКА НА ПАРУ «БАННЕР + СЕССИЯ». Показ обязан считаться ОДИН раз на
сессию: витрина перерисовывается на каждом переходе, и показ на перерисовку
превратил бы CTR в ложь. Уникальное ограничение делает это законом базы, а не
обещанием кода. В той же строке живут клики, и закрытие — поэтому «закрытый
баннер не возвращается» не требует ни третьей таблицы, ни памяти браузера.
"""

from __future__ import annotations

from django.db import models

from apps.core.fields import TranslatableField
from apps.core.models import TenantModel


class Banner(TenantModel):
    class Size(models.TextChoices):
        S = "s", "Узкий"
        M = "m", "Средний"
        L = "l", "Крупный"

    class Placement(models.TextChoices):
        TOP = "top", "Вверху витрины"
        BOTTOM = "bottom", "Внизу витрины"

    class Action(models.TextChoices):
        NONE = "none", "Без действия"
        LINK = "link", "Внешняя ссылка"
        VENUE = "venue", "Наше заведение"
        PAGE = "page", "Страница с описанием"

    # Внутреннее имя: его видит оператор в списке, гость — никогда.
    name = models.CharField(max_length=128)
    # Подпись на самом баннере. Пусто — баннер только картинка.
    title = TranslatableField(blank=True)
    subtitle = TranslatableField(blank=True)

    size = models.CharField(max_length=1, choices=Size.choices, default=Size.M)
    placement = models.CharField(max_length=8, choices=Placement.choices, default=Placement.TOP)

    action = models.CharField(max_length=8, choices=Action.choices, default=Action.NONE)
    action_url = models.URLField(max_length=512, blank=True)
    action_service = models.ForeignKey(
        "hotels.Service", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    # Своя страница с описанием: заголовок и текст живут здесь, а не в каталоге.
    # Класть рекламную страницу в каталог значило бы, что она поедет в поиск,
    # в разделы и в аналитику позиций — туда, где гость ищет услуги отеля.
    page_title = TranslatableField(blank=True)
    page_body = TranslatableField(blank=True)

    # --- Правила показа -------------------------------------------------
    is_active = models.BooleanField(default=True)
    starts_on = models.DateField(null=True, blank=True)
    ends_on = models.DateField(null=True, blank=True)
    # Время суток по часам ОТЕЛЯ. Пусто — целые сутки. Окно через полночь
    # (22:00–06:00) разрешено и считается как объединение двух отрезков.
    time_from = models.TimeField(null=True, blank=True)
    time_to = models.TimeField(null=True, blank=True)
    first_visit_only = models.BooleanField(default=False)
    # Пустой список — «все языки»: так правило не надо переписывать, добавив
    # отелю язык.
    languages = models.JSONField(default=list, blank=True)
    room_categories = models.ManyToManyField(
        "hotels.RoomCategory",
        blank=True,
        related_name="banners",
        through="promo.BannerRoomCategory",
    )

    # Больше число — выше приоритет. Совпали — разнимает время заведения,
    # чтобы выдача была устойчивой, а не менялась от запроса к запросу.
    priority = models.IntegerField(default=0)

    class Meta:
        db_table = "promo_banner"
        ordering = ["-priority", "created_at"]
        indexes = [models.Index(fields=["hotel", "is_active", "placement"])]

    def __str__(self) -> str:
        return self.name


class BannerRoomCategory(TenantModel):
    """
    Связка «баннер — категория номера» СВОЕЙ моделью, а не автоматической.

    Автоматическая таблица связи не имеет `hotel_id`, а значит остаётся вне
    RLS: единственная тенантная таблица без политики, про которую реестр
    молчит, потому что сторож ищет модели с полем `hotel`. Дыра, о которой
    никто не узнает, — худший вид дыры.

    ПОБОЧНОЕ СЛЕДСТВИЕ, О КОТОРОМ НАДО ЗНАТЬ: `banner.room_categories.add(...)`
    здесь НЕ РАБОТАЕТ. Django кладёт строки связи через `bulk_create`, минуя
    `save()`, — а именно `save()` проставляет отель из контекста. Строка уходит
    в базу с пустым `hotel_id` и отбивается политикой RLS. Это не молчаливая
    потеря, а громкий отказ на первой же попытке, и лечится он одной строкой:
    пользуйтесь `apps.promo.services.admin._set_categories` или создавайте
    строку связи явно, с `hotel_id`.
    """

    banner = models.ForeignKey(Banner, on_delete=models.CASCADE, related_name="+")
    room_category = models.ForeignKey(
        "hotels.RoomCategory", on_delete=models.CASCADE, related_name="+"
    )

    class Meta:
        db_table = "promo_banner_category"
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "banner", "room_category"], name="uniq_banner_room_category"
            )
        ]


class BannerImage(TenantModel):
    """Кадр карусели. Один — просто картинка, несколько — карусель."""

    banner = models.ForeignKey(Banner, on_delete=models.CASCADE, related_name="images")
    asset = models.ForeignKey("media.MediaAsset", on_delete=models.CASCADE, related_name="+")
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "promo_banner_image"
        ordering = ["sort_order"]


class BannerView(TenantModel):
    """
    Встреча баннера и сессии — одна строка на всю сессию.

    Отсюда берутся все четыре числа: показы — строки, клики — сумма, переходы
    — строки с кликом, CTR — переходы к показам. Делить клики на показы было
    бы делением разных единиц: показ у нас на сессию, а нажать гость может
    трижды.
    """

    banner = models.ForeignKey(Banner, on_delete=models.CASCADE, related_name="views")
    session = models.ForeignKey(
        "accounts.GuestSession", on_delete=models.CASCADE, related_name="banner_views"
    )
    shown_at = models.DateTimeField(auto_now_add=True)
    clicks = models.PositiveIntegerField(default=0)
    last_click_at = models.DateTimeField(null=True, blank=True)
    dismissed_at = models.DateTimeField(null=True, blank=True)
    # Язык и категория номера на момент показа — снимком. Настройка, по
    # которой считают ПРОШЛОЕ, фиксируется в момент события (правило волны 8).
    language = models.CharField(max_length=8, blank=True)
    room_category = models.CharField(max_length=64, blank=True)

    class Meta:
        db_table = "promo_banner_view"
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "banner", "session"], name="uniq_banner_view_per_session"
            )
        ]
        indexes = [models.Index(fields=["hotel", "banner", "shown_at"])]
