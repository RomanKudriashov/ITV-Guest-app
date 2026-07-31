"""
Отель — корень тенанта, и всё, что описывает его физическую и организационную
структуру: бренд, языки, номера, точки исполнения, локации, расписания.

Hotel сам по себе НЕ тенант-таблица: он платформенного уровня и RLS на него не
вешается (иначе отель нельзя было бы даже найти по поддомену до того, как
установлен контекст). Изоляция отелей друг от друга обеспечивается тем, что
всё остальное ссылается на hotel_id и закрыто политиками.
"""

from __future__ import annotations

import dataclasses
import zoneinfo
from datetime import datetime, time

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from apps.core.fields import TranslatableField
from apps.core.models import BaseModel, TenantModel


class Hotel(BaseModel):
    name = models.CharField(max_length=255)
    subdomain = models.SlugField(max_length=63, unique=True, db_index=True)
    # Отель может привести свой домен (menu.crystal-hotel.ru) — резолвим и по нему.
    custom_domain = models.CharField(max_length=255, blank=True, db_index=True)

    timezone = models.CharField(max_length=64, default="Europe/Moscow")
    default_language = models.CharField(max_length=8, default="en")
    currency = models.CharField(max_length=3, default="RUB")
    # Число знаков после запятой, то есть ПОКАЗАТЕЛЬ СТЕПЕНИ, а не множитель:
    # 2 → в рубле 10² = 100 копеек; 0 → в иене нет дробной части.
    # Цены везде хранятся в минимальных единицах, целыми, без float.
    currency_minor_units = models.PositiveSmallIntegerField(default=2)

    default_theme = models.ForeignKey(
        "hotels.BrandTheme",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    is_active = models.BooleanField(default=True)
    settings = models.JSONField(default=dict, blank=True)

    # --- Происхождение отеля -------------------------------------------------
    # Откуда он взялся: завела платформа, создал автотест или это витринное
    # демо. Признак нужен ровно затем, чтобы тестовые отели было ЧЕМ отличить
    # от настоящих — до него единственным способом было угадывание по имени
    # («E2E …») и поддомену («e2e…»), а угадывание нельзя ни доверить чистке,
    # ни объяснить тому, чей отель по ошибке назвали тестовым.
    #
    # Ставится в момент создания и потом не меняется: происхождение — факт
    # биографии, а не текущее состояние.
    class Origin(models.TextChoices):
        LIVE = "live", "Боевой"
        DEMO = "demo", "Демонстрационный"
        TEST = "test", "Создан автотестом"

    origin = models.CharField(
        max_length=8, choices=Origin.choices, default=Origin.LIVE, db_index=True
    )

    # Отзывы: собирать ли оценку после завершения и порог «низкой» оценки,
    # при которой уведомляется менеджер (service recovery).
    review_enabled = models.BooleanField(default=True)
    review_low_threshold = models.PositiveSmallIntegerField(default=3)

    # --- Коммерция. По умолчанию всё выключено: суммы = сумме позиций,
    # поведение старых заказов не меняется, пока отель не включит в CMS. ---
    # Сервисный сбор и налог — в базисных пунктах (1000 = 10.00%).
    service_fee_bp = models.PositiveIntegerField(default=0)
    tax_bp = models.PositiveIntegerField(default=0)
    tax_inclusive = models.BooleanField(default=True)
    tip_presets = models.JSONField(default=list, blank=True)
    free_delivery_threshold_minor = models.IntegerField(null=True, blank=True)
    # Округление итога к кратному (100 = до целой валютной единицы). 0/1 = нет.
    price_round_to_minor = models.PositiveIntegerField(default=0)

    # Витрина главной: порог группировки заведений/услуг в bento. Заведений
    # одного рода ≤ порога — отдельные плитки со своими обложками; больше —
    # одна плитка-категория с превью обложек внутри.
    showcase_group_threshold = models.PositiveSmallIntegerField(default=3)

    # Тариф отеля — шов биллинга: проставляется руками (деньги вне системы).
    # Сам по себе лишь пометка уровня; какие модули включены — в HotelModule.
    # Сетка тарифов объявлена кодом — apps/hotels/tariffs.py.
    tariff = models.CharField(max_length=64, blank=True)
    # Когда тариф начался и когда истекает триал. Даты, а не моменты: у тарифа
    # нет часа начала, он живёт в календаре платформы, и «до конца дня» —
    # ровно то поведение, которого ждут от последнего дня триала.
    tariff_started_on = models.DateField(null=True, blank=True)
    trial_ends_at = models.DateField(null=True, blank=True)

    class Meta:
        db_table = "hotels_hotel"
        ordering = ["name"]

    def __str__(self) -> str:
        return f"{self.name} ({self.subdomain})"

    @property
    def tzinfo(self) -> zoneinfo.ZoneInfo:
        try:
            return zoneinfo.ZoneInfo(self.timezone)
        except zoneinfo.ZoneInfoNotFoundError:
            return zoneinfo.ZoneInfo("UTC")

    def local_now(self) -> datetime:
        from django.utils import timezone as dj_timezone

        return dj_timezone.now().astimezone(self.tzinfo)

    def to_local(self, moment: datetime) -> datetime:
        return moment.astimezone(self.tzinfo)

    def public_guest_url(self, path: str = "") -> str:
        """
        Публичный адрес витрины отеля — база для QR и ссылок.

        Кастомный домен, если отель его привёл, иначе поддомен на базовом
        домене платформы. Именно этот адрес кодирует QR: скан ведёт гостя на
        рабочий deep-link /r/<номер>.
        """
        from django.conf import settings

        host = self.custom_domain or f"{self.subdomain}.{settings.GUEST_APP_BASE_DOMAIN}"
        return f"{settings.GUEST_APP_PUBLIC_SCHEME}://{host}{path}"

    # Канонический путь гостевого deep-link. ЕДИНСТВЕННОЕ место, где живёт
    # префикс /r/: этот адрес зашит в печатные QR, менять его задним числом
    # нельзя. Подробности — docs/deep-links.md.
    DEEPLINK_ROOM_PREFIX = "/r/"

    def room_deeplink(
        self,
        room_number: str,
        *,
        lang: str | None = None,
        source: str | None = None,
        token: str | None = None,
    ) -> str:
        """
        Deep-link на вход гостя по номеру: `<адрес отеля>/r/<номер>`.

        Собирается ТОЛЬКО здесь — и QR, и матрица номеров, и любой будущий
        клиент зовут эту функцию, чтобы схемы не разъехались склейкой строк.
        Необязательные параметры (язык, источник входа, разовый токен) —
        задел под приложение/ТВ/ключи со стойки; сейчас просто прокидываются
        в query, поведение витрины они не меняют.
        """
        from urllib.parse import urlencode

        path = f"{self.DEEPLINK_ROOM_PREFIX}{room_number}"
        params = [(key, value) for key, value in (("lang", lang), ("src", source), ("t", token)) if value]
        if params:
            path = f"{path}?{urlencode(params)}"
        return self.public_guest_url(path)


class BrandTheme(TenantModel):
    """
    Токены оформления отеля. Единственный источник цвета для фронта —
    на фронте не должно быть ни одного захардкоженного значения.

    Формат tokens совпадает с BrandTokens в frontend/src/theme/tokens.ts.
    """

    name = models.CharField(max_length=128)
    is_preset = models.BooleanField(
        default=False, help_text="Пресет-заготовка, а не рабочая тема отеля"
    )
    tokens = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "hotels_brand_theme"
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class HotelLanguage(TenantModel):
    code = models.CharField(max_length=8)
    title = models.CharField(max_length=64, blank=True)
    is_active = models.BooleanField(default=True)
    is_default = models.BooleanField(default=False)
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "hotels_hotel_language"
        ordering = ["sort_order", "code"]
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "code"], name="uniq_language_per_hotel"
            )
        ]

    def __str__(self) -> str:
        return self.code


class Room(TenantModel):
    class Source(models.TextChoices):
        MANUAL = "manual", "Заведён вручную"
        PMS = "pms", "Синхронизирован из PMS"

    number = models.CharField(max_length=32, db_index=True)
    floor = models.CharField(max_length=16, blank=True)
    zone = models.CharField(max_length=64, blank=True, help_text="Корпус, крыло, зона")
    source = models.CharField(max_length=16, choices=Source.choices, default=Source.MANUAL)
    external_id = models.CharField(max_length=128, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "hotels_room"
        ordering = ["number"]
        constraints = [
            models.UniqueConstraint(fields=["hotel", "number"], name="uniq_room_per_hotel")
        ]

    def __str__(self) -> str:
        return self.number


class ExecutionPoint(TenantModel):
    """
    Точка исполнения — кто физически выполняет заявку: кухня, бар, SPA,
    хозслужба. На неё маршрутизируются заказы (Route) и назначается персонал
    (StaffAssignment); её канал слушает трекер по WebSocket.
    """

    class Kind(models.TextChoices):
        KITCHEN = "kitchen", "Кухня"
        BAR = "bar", "Бар"
        HOUSEKEEPING = "housekeeping", "Хозслужба"
        SPA = "spa", "SPA"
        RECEPTION = "reception", "Ресепшен"
        OTHER = "other", "Прочее"

    code = models.SlugField(max_length=64)
    # Служебное название — его видят только персонал, трекер, эскалации,
    # аналитика. Гостю оно не показывается. Гостевая идентичность (public_name,
    # tagline, фото, is_guest_facing) и венью-часы (schedule) переехали на
    # Service — точка исполнения теперь чистый исполнитель.
    title = TranslatableField()
    kind = models.CharField(max_length=32, choices=Kind.choices, default=Kind.OTHER)
    is_active = models.BooleanField(default=True)
    # Через сколько минут ожидания заказ на доске считается просроченным.
    # Настройка точки, а не константа: кухне и хозслужбе нужны разные пороги.
    sla_minutes = models.PositiveSmallIntegerField(default=20)

    class Meta:
        db_table = "hotels_execution_point"
        ordering = ["code"]
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "code"], name="uniq_execution_point_per_hotel"
            )
        ]

    def __str__(self) -> str:
        return self.code

    @property
    def realtime_group(self) -> str:
        """Имя группы Channels, в которую летят события трекера."""
        return f"tracker.{self.hotel_id}.{self.pk}"


class Location(TenantModel):
    """
    Куда доставлять. Два вида: в номер и общая точка (у бассейна, лобби-бар).
    Общая точка может требовать уточнения — «шезлонг №», «столик №».
    """

    class Kind(models.TextChoices):
        IN_ROOM = "in_room", "В номер"
        COMMON_POINT = "common_point", "Общая точка"

    code = models.SlugField(max_length=64)
    kind = models.CharField(max_length=32, choices=Kind.choices, default=Kind.IN_ROOM)
    title = TranslatableField()
    requires_refinement = models.BooleanField(default=False)
    refinement_label = TranslatableField()
    schedule = models.ForeignKey(
        "hotels.Schedule", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    sort_order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    # Стоимость доставки в эту локацию; 0 = бесплатно. Порог бесплатной
    # доставки — на уровне отеля.
    delivery_fee_minor = models.IntegerField(default=0)

    class Meta:
        db_table = "hotels_location"
        ordering = ["sort_order", "code"]
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "code"], name="uniq_location_per_hotel"
            )
        ]

    def __str__(self) -> str:
        return self.code


@dataclasses.dataclass(slots=True)
class ScheduleAvailability:
    """Ответ расписания витрине: открыто ли и, если нет, когда откроется."""

    is_open: bool
    available_from: str | None = None   # «07:00» в таймзоне отеля
    available_until: str | None = None
    available_at: datetime | None = None


class Schedule(TenantModel):
    """
    Расписание доступности (категории, позиции, точки исполнения).
    Всё считается в таймзоне отеля — никаких «серверных» суток.
    """

    name = models.CharField(max_length=128)
    is_always_open = models.BooleanField(default=False)

    class Meta:
        db_table = "hotels_schedule"
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name

    def local_moment(self, moment: datetime | None = None) -> datetime:
        hotel = self.hotel
        return hotel.to_local(moment) if moment else hotel.local_now()

    def is_open_at(self, moment: datetime | None = None) -> bool:
        if self.is_always_open:
            return True
        local = self.local_moment(moment)
        return any(interval.covers_datetime(local) for interval in self.intervals.all())

    def availability_at(self, moment: datetime | None = None) -> "ScheduleAvailability":
        """
        Не просто «открыто/закрыто», а ещё и когда откроется.

        Считать это обязан сервер: у гостя в телефоне может быть другая
        таймзона, и «с 07:00» по его часам означало бы совсем не то время.
        """
        if self.is_always_open:
            return ScheduleAvailability(is_open=True)

        local = self.local_moment(moment)
        intervals = list(self.intervals.all())
        if not intervals:
            # Расписание без интервалов — это «никогда», а не «всегда».
            return ScheduleAvailability(is_open=False)

        for interval in intervals:
            if interval.covers_datetime(local):
                return ScheduleAvailability(
                    is_open=True, available_until=interval.end_time.strftime("%H:%M")
                )

        next_start = self._next_start_after(local, intervals)
        return ScheduleAvailability(
            is_open=False,
            available_from=next_start.strftime("%H:%M") if next_start else None,
            available_at=next_start,
        )

    @staticmethod
    def _next_start_after(local: datetime, intervals: list["ScheduleInterval"]):
        """Ближайшее открытие в пределах недели. None — если расписание пустое."""
        from datetime import datetime as dt
        from datetime import timedelta

        for offset in range(8):
            day = (local + timedelta(days=offset)).date()
            weekday = (local.weekday() + offset) % 7
            candidates = sorted(
                interval.start_time for interval in intervals if interval.weekday == weekday
            )
            for start in candidates:
                moment = dt.combine(day, start, tzinfo=local.tzinfo)
                if moment > local:
                    return moment
        return None

    def day_parts_at(self, moment: datetime | None = None) -> list[str]:
        local = self.local_moment(moment)
        return [
            interval.day_part
            for interval in self.intervals.all()
            if interval.day_part and interval.covers_datetime(local)
        ]


class ScheduleInterval(TenantModel):
    """
    Один недельный интервал. Day-parting (завтрак/обед/ужин) — это тот же
    интервал с меткой day_part: одна сущность вместо двух похожих.
    """

    schedule = models.ForeignKey(
        Schedule, on_delete=models.CASCADE, related_name="intervals"
    )
    weekday = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(0), MaxValueValidator(6)],
        help_text="0 — понедельник, 6 — воскресенье",
    )
    start_time = models.TimeField()
    end_time = models.TimeField()
    day_part = models.SlugField(max_length=32, blank=True)

    class Meta:
        db_table = "hotels_schedule_interval"
        ordering = ["weekday", "start_time"]

    def __str__(self) -> str:
        return f"{self.weekday} {self.start_time}–{self.end_time}"

    def covers(self, moment: time) -> bool:
        """Только по времени, без учёта дня недели. См. covers_datetime."""
        if self.start_time <= self.end_time:
            return self.start_time <= moment < self.end_time
        # Интервал через полночь (23:00–02:00): бар работает ночью.
        return moment >= self.start_time or moment < self.end_time

    def covers_datetime(self, local: datetime) -> bool:
        """
        Проверка с учётом дня недели — единственно верная для интервалов через
        полночь. «Пятница 23:00–02:00» — это ночь с пятницы на субботу, то есть
        суббота 01:00 покрывается ПЯТНИЧНЫМ интервалом, а не субботним.
        Наивная проверка «день совпал И время попало» ошибается в обе стороны.
        """
        weekday = local.weekday()
        moment = local.time()

        if self.start_time <= self.end_time:
            return weekday == self.weekday and self.start_time <= moment < self.end_time

        if weekday == self.weekday and moment >= self.start_time:
            return True
        return weekday == (self.weekday + 1) % 7 and moment < self.end_time


class ShowcaseTile(TenantModel):
    """
    Настройки плитки главной-витрины: размер, порядок, показ. Наложение на
    ВЫЧИСЛЯЕМЫЙ набор плиток — сами плитки строятся из данных отеля (заведения,
    категории услуг, инфо), а эта таблица лишь переопределяет их вид. Ключ
    стабилен: код точки исполнения, код группы («restaurants»/«services») или
    служебный («info», «room-control»). Строки нет — плитка берёт дефолт.
    """

    class Size(models.TextChoices):
        S = "s", "S"
        M = "m", "M"
        L = "l", "L"

    key = models.SlugField(max_length=80)
    size = models.CharField(max_length=1, choices=Size.choices, default=Size.M)
    sort_order = models.PositiveSmallIntegerField(default=0)
    is_enabled = models.BooleanField(default=True)

    class Meta:
        db_table = "hotels_showcase_tile"
        ordering = ["sort_order", "key"]
        constraints = [
            models.UniqueConstraint(fields=["hotel", "key"], name="uniq_showcase_tile_per_hotel")
        ]

    def __str__(self) -> str:
        return self.key


class Service(TenantModel):
    """
    Гостевой сервис — типизированный контейнер: ресторан, бар, спа, такси,
    консьерж, рум-сервис, инфо-раздел, мини-бар. Надстройка над исполнителем
    (ExecutionPoint): сервис несёт гостевую идентичность, тип-шаблон, венью-
    расписание и свою коммерцию; исполнение (кухня/бригада, маршрут заказа,
    трекер, персонал, эскалации) остаётся на ExecutionPoint.

    В R1 связь 1:1 (unique по execution_point). FK, а не OneToOne, потому что R2
    ослабит её под заимствование чужого контента и разъезд заказа по нескольким
    исполнителям (fan-out) — тип поля тогда менять не придётся.

    Пять слоёв (docs/design/guest-hub-design-map.md, Часть 0):
      1. тип/шаблон — из каких кирпичей собран (Service.Type поверх OfferingType);
      2. наполнение — Category.service → контент сервиса;
      3. доступность — schedule (венью-часы) + локации (пока на уровне категории);
      4. исполнение — execution_point (исполнитель по умолчанию);
      5. коммерция — свои сбор/чаевые/минимум/доставка (null = наследовать отель).
    """

    class Type(models.TextChoices):
        RESTAURANT = "restaurant", "Ресторан"
        BAR = "bar", "Бар"
        ROOM_SERVICE = "room_service", "Рум-сервис"
        SPA = "spa", "SPA"
        POOL = "pool", "Бассейн"
        TRANSFER = "transfer", "Трансфер/такси"
        CONCIERGE = "concierge", "Консьерж"
        EXCURSIONS = "excursions", "Экскурсии"
        HOUSEKEEPING = "housekeeping", "Хозслужба"
        MINIBAR = "minibar", "Мини-бар/магазин"
        INFO = "info", "Инфо-раздел"
        CUSTOM = "custom", "Свой"

    code = models.SlugField(max_length=64)
    type = models.CharField(max_length=32, choices=Type.choices, default=Type.CUSTOM)
    # Исполнитель по умолчанию. 1:1 в R1 (unique ниже); PROTECT — сервис нельзя
    # осиротить, удаление исполнителя идёт через удаление сервиса.
    execution_point = models.ForeignKey(
        ExecutionPoint, on_delete=models.PROTECT, related_name="services"
    )

    # --- Гостевая идентичность (перенесена с ExecutionPoint в R1) ---
    public_name = TranslatableField()
    tagline = TranslatableField()
    # Показывать ли сервис гостю как заведение на витрине. Служебные (хозслужба,
    # кухня рум-сервиса) — false.
    is_guest_facing = models.BooleanField(default=True)
    image = models.ForeignKey(
        "media.MediaAsset", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    # Венью-часы (перенесены с ExecutionPoint). Доступность категорий/позиций
    # считается их собственными расписаниями; это — часы самого заведения,
    # которые витрина показывает пилюлей «открыто до 23:00».
    schedule = models.ForeignKey(
        "hotels.Schedule", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    is_active = models.BooleanField(default=True)
    sort_order = models.PositiveSmallIntegerField(default=0)

    # --- Коммерция уровня сервиса. null = наследовать значение отеля. Налог,
    # валюта и налоговый режим остаются на отеле (единственная коммерция уровня
    # отеля — по карте продукта). Пока оверрайд null, суммы те же, что и были. ---
    service_fee_bp = models.PositiveIntegerField(null=True, blank=True)
    tip_presets = models.JSONField(null=True, blank=True)
    min_order_minor = models.IntegerField(null=True, blank=True)
    free_delivery_threshold_minor = models.IntegerField(null=True, blank=True)
    price_round_to_minor = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        db_table = "hotels_service"
        ordering = ["sort_order", "code"]
        constraints = [
            models.UniqueConstraint(fields=["hotel", "code"], name="uniq_service_per_hotel"),
            models.UniqueConstraint(
                fields=["hotel", "execution_point"], name="uniq_service_per_execution_point"
            ),
        ]

    def __str__(self) -> str:
        return self.code

    @property
    def public_title(self) -> dict:
        """Гостевое название с падением на служебное имя исполнителя."""
        return self.public_name or self.execution_point.title or {}

    def commerce_value(self, hotel: "Hotel", field: str):
        """
        Эффективное значение коммерч. поля: оверрайд сервиса, иначе — отеля.
        Единственное место, где живёт правило фолбэка «сервис → отель».
        """
        own = getattr(self, field)
        return own if own is not None else getattr(hotel, field)


class HotelModule(TenantModel):
    """
    Реестр модулей отеля: какие платные фичи включены — по тарифу или точечным
    исключением (выдать модуль вне тарифа пилоту). В R1 — только данные + API;
    управляющий UI — R6, гейтинг CMS-навигации — R4. Именно этот реестр решает,
    что отель видит в своей CMS: без модуля отель не видит ни одного его экрана.
    """

    class Code(models.TextChoices):
        ROOM_CONTROL = "room_control", "Управление номером (GRMS)"
        PAYMENT = "payment", "Оплата"
        PMS = "pms", "PMS"
        MOBILE_KEY = "mobile_key", "Мобильный ключ"
        MULTI_RESTAURANT = "multi_restaurant", "Мультиресторанность"
        MARKETING = "marketing", "Маркетинг"
        EXTRA_LANGUAGES = "extra_languages", "Доп. языки"
        NATIVE_APP = "native_app", "Нативное приложение"
        ANALYTICS_LEVEL = "analytics_level", "Уровень аналитики"

    class Source(models.TextChoices):
        TARIFF = "tariff", "По тарифу"
        OVERRIDE = "override", "Переопределение (вне тарифа)"

    code = models.SlugField(max_length=32)
    is_enabled = models.BooleanField(default=False)
    source = models.CharField(max_length=16, choices=Source.choices, default=Source.TARIFF)
    # Доп. конфигурация модуля (напр. уровень аналитики: {"level": "advanced"}).
    config = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "hotels_hotel_module"
        ordering = ["code"]
        constraints = [
            models.UniqueConstraint(fields=["hotel", "code"], name="uniq_module_per_hotel"),
        ]

    def __str__(self) -> str:
        return f"{self.code}={'on' if self.is_enabled else 'off'}"


class OnPremNode(TenantModel):
    """
    Он-прем узел отеля (Local Connector).

    Нужен, как только отелю включили GRMS или PMS: этими системами управляют из
    локальной сети объекта, и облако не может дотянуться до них напрямую. Узел —
    коробка на сервере отеля, которая ходит наружу сама и отмечается здесь.

    Платформа держит про узел ровно то, что нужно, чтобы понять «жив ли он и
    можно ли ему верить»: когда откликался и не отозван ли ключ. Ни адресов
    внутренней сети, ни учёток оборудования тут нет — они остаются на объекте.

    Хранится ХЭШ ключа, а не ключ: утечка этой таблицы не должна давать доступ
    к чужому оборудованию. Сам ключ показывается один раз при выдаче.
    """

    class Purpose(models.TextChoices):
        GRMS = "grms", "Управление номером"
        PMS = "pms", "PMS"
        BOTH = "both", "GRMS + PMS"

    name = models.CharField(max_length=128)
    purpose = models.CharField(max_length=16, choices=Purpose.choices, default=Purpose.GRMS)
    key_hash = models.CharField(max_length=64, blank=True)
    key_issued_at = models.DateTimeField(null=True, blank=True)
    is_revoked = models.BooleanField(default=False)
    last_seen_at = models.DateTimeField(null=True, blank=True)
    version = models.CharField(max_length=32, blank=True)

    class Meta:
        db_table = "hotels_onprem_node"
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["hotel", "name"], name="uniq_node_per_hotel"),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.purpose})"

    # Порог «жив»: узел отмечается раз в минуту, три пропуска подряд — уже не
    # сетевая икота, а повод показать это платформе.
    OFFLINE_AFTER_SECONDS = 180

    @property
    def seconds_since_seen(self) -> int | None:
        if not self.last_seen_at:
            return None
        from django.utils import timezone as dj_timezone

        return int((dj_timezone.now() - self.last_seen_at).total_seconds())

    @property
    def is_online(self) -> bool:
        seconds = self.seconds_since_seen
        return seconds is not None and seconds <= self.OFFLINE_AFTER_SECONDS

    @property
    def is_registered(self) -> bool:
        """Зарегистрирован — значит ключ выдан и не отозван."""
        return bool(self.key_hash) and not self.is_revoked
