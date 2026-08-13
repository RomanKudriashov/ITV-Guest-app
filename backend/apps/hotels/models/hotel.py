"""
Отель — корень тенанта — и языки его витрины.
"""

from __future__ import annotations

import zoneinfo
from datetime import datetime

from django.db import models

from apps.core.fields import TranslatableField
from apps.core.managers import AllObjectsManager, BaseManager, SoftDeleteQuerySet
from apps.core.models import BaseModel, TenantModel


class HotelQuerySet(SoftDeleteQuerySet):
    """
    Массовое удаление отелей идёт ПО ОДНОМУ.

    `SoftDeleteQuerySet.delete()` — это один UPDATE, и он бы проставил
    `deleted_at`, не тронув поддомены: имя сгорало бы ровно так же, только
    мимо модели. Отели удаляют поштучно и редко, цикл здесь ничего не стоит,
    а гарантия становится свойством модели, а не места вызова.
    """

    def delete(self):
        removed = 0
        for hotel in self:
            hotel.delete()
            removed += 1
        return (0, {"hotels.Hotel": removed} if removed else {})


class HotelManager(BaseManager.from_queryset(HotelQuerySet)):
    pass


class HotelAllObjectsManager(AllObjectsManager.from_queryset(HotelQuerySet)):
    pass


class Hotel(BaseModel):
    # Переводимое: гость с китайским интерфейсом не должен читать в шапке
    # «Отель „Кристалл“». Имя собственное остаётся как есть на всех языках —
    # так его пишут на вывеске и в картах, — переводится слово вокруг него.
    # Читать через `name_i18n`: он отдаёт язык запроса с фолбэком на язык
    # отеля, а само поле — словарь.
    name = TranslatableField()
    subdomain = models.SlugField(max_length=63, unique=True, db_index=True)
    # Имя, под которым отель жил до удаления.
    #
    # При мягком удалении поддомен переименовывается в припаркованный вид, и
    # настоящее имя иначе было бы потеряно: журнал, разбор инцидента и ответ
    # на вопрос «а что было на crystal?» опираются именно на него. Живой отель
    # это поле не заполняет.
    former_subdomain = models.SlugField(max_length=63, blank=True, db_index=True)
    # Отель может привести свой домен (menu.crystal-hotel.ru) — резолвим и по нему.
    custom_domain = models.CharField(max_length=255, blank=True, db_index=True)

    timezone = models.CharField(max_length=64, default="Europe/Moscow")

    # Координаты отеля — для погоды на главной витрины. Пусто у подавляющего
    # большинства отелей, и это нормальное состояние, а не незаполненность:
    # блок погоды без координат просто не показывается.
    #
    # Хранятся числами, а не строкой «55.75, 37.62»: их отдают провайдеру
    # погоды, и разбирать строку перед каждым запросом — способ однажды
    # отправить в него мусор. Точность 6 знаков после запятой — около 10 см,
    # больше отелю не нужно.
    latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)

    # Город — ПОДПИСЬ к погоде и часам: «Москва · 21° · 01:58». Без неё гость,
    # приехавший издалека, читает цифры как «здесь», а «здесь» у него своё.
    #
    # Переводимое поле, а не строка: город у гостя называется на его языке
    # (Москва / Moscow / موسكو / 莫斯科), и подставлять кириллицу в арабский
    # интерфейс — то же самое, что показывать ему английское «Mainly clear».
    #
    # ЗАПОЛНЯЕТ ОТЕЛЬ, а не геокодер по координатам. Обратное геокодирование —
    # ещё один внешний сервис с лицензией и лимитами ради строки, которую
    # оператор пишет один раз и точнее: у отеля на окраине формально другой
    # населённый пункт, а гостю нужен тот город, за которым он приехал.
    city = TranslatableField()

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

    objects = HotelManager()
    all_objects = HotelAllObjectsManager()

    class Meta:
        db_table = "hotels_hotel"
        ordering = ["name"]

    def __str__(self) -> str:
        return f"{self.name_i18n} ({self.subdomain})"

    def parked_subdomain(self, when: datetime | None = None) -> str:
        """
        Имя, под которым удалённая строка занимает индекс, никому не мешая.

        Детерминированно: тот же отель, удалённый в тот же день, получает то
        же имя — иначе повтор миграции или ручной прогон плодили бы разные
        призраки одной строки. Хвост из pk разводит два удаления одного имени
        в один день: без него второе падало бы тем же IntegrityError, от
        которого всё это и лечится.
        """
        from django.utils import timezone as dj_timezone

        moment = when or self.deleted_at or dj_timezone.now()
        tail = f"-deleted-{moment.strftime('%Y%m%d')}-{self.pk.hex[:6]}"
        base = (self.former_subdomain or self.subdomain)[: 63 - len(tail)]
        return f"{base}{tail}"

    def delete(self, using=None, keep_parents=False, *, hard: bool = False):
        """
        Мягкое удаление ОСВОБОЖДАЕТ поддомен.

        Уникальный индекс не знает про `deleted_at` и видит удалённую строку
        наравне с живыми. Поэтому удалённый отель сжигал своё имя навсегда:
        завести `crystal` заново было нельзя — оператор получал не «имя
        занято», а необъяснённое 500 из IntegrityError.

        Настоящее имя не теряется, оно переезжает в `former_subdomain`.
        Маршрутизация на старое имя умирает в тот же момент и без всякого
        кэша: резолвер ищет отель по `subdomain` среди живых, а тут не стало
        ни того, ни другого.
        """
        from django.utils import timezone as dj_timezone

        if hard:
            return super().delete(using=using, keep_parents=keep_parents, hard=True)

        self.deleted_at = self.deleted_at or dj_timezone.now()
        if not self.former_subdomain:
            self.former_subdomain = self.subdomain
        self.subdomain = self.parked_subdomain()
        self.save(
            using=using,
            update_fields=["deleted_at", "subdomain", "former_subdomain", "updated_at"],
        )
        return (0, {})

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
