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

    # Отзывы: собирать ли оценку после завершения и порог «низкой» оценки,
    # при которой уведомляется менеджер (service recovery).
    review_enabled = models.BooleanField(default=True)
    review_low_threshold = models.PositiveSmallIntegerField(default=3)

    # --- Коммерция (A3+). По умолчанию всё выключено: суммы = сумме позиций,
    # поведение старых заказов не меняется, пока отель не включит в CMS. ---
    # Сервисный сбор и налог — в базисных пунктах (1000 = 10.00%).
    service_fee_bp = models.PositiveIntegerField(default=0)
    tax_bp = models.PositiveIntegerField(default=0)
    tax_inclusive = models.BooleanField(default=True)
    tip_presets = models.JSONField(default=list, blank=True)
    free_delivery_threshold_minor = models.IntegerField(null=True, blank=True)
    # Округление итога к кратному (100 = до целой валютной единицы). 0/1 = нет.
    price_round_to_minor = models.PositiveIntegerField(default=0)

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
    title = TranslatableField()
    kind = models.CharField(max_length=32, choices=Kind.choices, default=Kind.OTHER)
    is_active = models.BooleanField(default=True)
    schedule = models.ForeignKey(
        "hotels.Schedule", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    # Через сколько минут ожидания заказ на доске считается просроченным.
    # Настройка точки, а не константа: кухне и хозслужбе нужны разные пороги.
    sla_minutes = models.PositiveSmallIntegerField(default=20)
    # Минимальная сумма заказа на точку (A3+); null = нет порога.
    min_order_minor = models.IntegerField(null=True, blank=True)

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
    # Стоимость доставки в эту локацию (A3+); 0 = бесплатно. Порог бесплатной
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
