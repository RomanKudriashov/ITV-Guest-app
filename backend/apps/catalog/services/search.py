"""
Глобальный поиск гостя: заведения, позиции меню и информационные страницы.

ЗАЧЕМ. Гость помнит блюдо, но не помнит, в каком ресторане оно было. Меню
каждого заведения ищется само по себе, и до этого модуля искать «трюфель» было
негде.

КАК УСТРОЕНО. Стога сена собираются ВЫРАЖЕНИЕМ ПРЯМО В SQL из переводимых
полей: `title::text` у JSONB отдаёт все языки разом. Отдельной денормализованной
колонки нет намеренно — она живёт ровно до первой правки, сделанной мимо того
места, где её обновляют, и дальше молча врёт. Индексы поставлены на те же
выражения (см. миграцию), поэтому цена совпадает.

ЧТО ИМЕННО СЧИТАЕТСЯ СОВПАДЕНИЕМ — три разных вопроса, и каждый закрыт своим
средством:

  1. ПОДСТРОКА (`ILIKE %q%`). Единственное, что работает на языках без пробелов
     между словами: китайский запрос «寿司» — это не слово в понимании
     полнотекстового поиска, а два иероглифа посреди строки.
  2. НАЧАЛО СЛОВА. Отдельной веткой, чтобы «трюф» находил трюфель, а не только
     то, где эта последовательность встретилась в середине.
  3. ОПЕЧАТКИ — `word_similarity` из pg_trgm: он сравнивает запрос с ЛУЧШИМ
     куском текста, а не со всей строкой целиком. Обычная `similarity` на
     длинном описании даёт около нуля даже при точном попадании.

ЧЕСТНО ПРО ЯЗЫКИ. Латиница и кириллица закрыты полностью: и начало слова, и
опечатки. Китайский и японский ищутся ТОЛЬКО подстрокой: триграммы на письме
без пробелов работают плохо, а опечаток в иероглифах не бывает в том смысле, в
каком они бывают в буквах. Арабский ищется подстрокой и по началу слова, но
опечатки прощаются хуже: слово меняет форму приставками и слитными предлогами,
и «лучший кусок» находится не всегда. Это ограничение названо здесь и в отчёте,
а не оставлено тихо неработающим.

ИЗОЛЯЦИЯ ОТЕЛЯ. Каждый запрос идёт через тенант-менеджер, то есть с фильтром по
отелю, поверх которого лежит ещё и RLS Postgres. Двух заслонов здесь не много:
поиск — единственное место продукта, куда гость передаёт произвольный текст, и
цена ошибки тут не «нашлось лишнее», а чужой отель в выдаче.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from django.db.models import F, FloatField, Func, Q, QuerySet, TextField, Value
from django.db.models.functions import Cast, Coalesce, Concat, Lower

from apps.core.fields import translate

# Ниже этого порога совпадение по опечатке перестаёт быть похожестью и
# становится случайностью. 0.42 подобран по демо-данным: «трюфел», «труфель» и
# «trufle» находят трюфель, «стол» уже не находит «стейк».
TYPO_THRESHOLD = 0.42

# Ищем от двух символов: на одном совпадёт половина меню, и это не поиск.
MIN_QUERY = 2

# Сколько отдаём в каждой группе. Больше гость всё равно не читает, а витрина
# рисует группами и должна оставаться быстрой.
GROUP_LIMIT = 12


class WordSimilarity(Func):
    """`word_similarity(запрос, стог)` из pg_trgm — похожесть лучшего куска."""

    function = "word_similarity"
    output_field = FloatField()


@dataclass(frozen=True)
class SearchSettings:
    """Что участвует в выдаче. Умолчание — всё, что видно гостю."""

    services: bool = True
    items: bool = True
    info: bool = True
    excluded_services: tuple[str, ...] = ()

    @classmethod
    def of(cls, hotel) -> "SearchSettings":
        raw = (hotel.settings or {}).get("search") or {}
        layers = raw.get("layers") or {}
        return cls(
            services=bool(layers.get("services", True)),
            items=bool(layers.get("items", True)),
            info=bool(layers.get("info", True)),
            excluded_services=tuple(raw.get("excluded_services") or ()),
        )


def suggestions_of(hotel, language: str | None) -> list[str]:
    """
    Подсказки-заготовки из CMS для пустого поля.

    Пусто — значит пусто: придумывать за отель «завтрак» и «трансфер» нельзя,
    у него может не быть ни того ни другого.
    """
    raw = (hotel.settings or {}).get("search") or {}
    out = []
    for entry in raw.get("suggestions") or []:
        text = translate(entry, language) if isinstance(entry, dict) else str(entry)
        if text:
            out.append(text)
    return out


def _haystack(*fields: str):
    """
    Стог из переводимых полей: JSONB приводится к тексту целиком, поэтому в
    него попадают ВСЕ языки сразу.

    Это и есть ответ на «ищем по языку интерфейса, но не прячем совпадения в
    других»: название, которое отель заполнил только по-русски, находится и при
    английском интерфейсе — потому что в стоге лежат обе строки.
    """
    parts: list[Any] = []
    for field in fields:
        if parts:
            parts.append(Value(" ", output_field=TextField()))
        parts.append(
            Coalesce(Cast(F(field), TextField()), Value("", output_field=TextField()))
        )
    # `Concat` требует минимум двух слагаемых — у стога из одного поля
    # (название) их одно. Добавляем пустую строку: SQL от этого не меняется.
    if len(parts) == 1:
        parts.append(Value("", output_field=TextField()))
    return Lower(Concat(*parts, output_field=TextField()))


def _matches(query: str) -> tuple[Q, Any]:
    """Условие совпадения и выражение ранга по стогу `haystack`."""
    lowered = query.lower()
    condition = (
        # Подстрока — она же единственный путь для письма без пробелов.
        Q(haystack__contains=lowered)
        # Начало слова: «трюф» → «трюфель».
        | Q(haystack__regex=rf"(^|[^[:alnum:]]){_escape(lowered)}")
        # Опечатки.
        | Q(typo__gt=TYPO_THRESHOLD)
    )
    return condition, WordSimilarity(Value(lowered), F("haystack"))


def _escape(value: str) -> str:
    """Экранируем то, что Postgres примет за синтаксис регулярного выражения."""
    return "".join("\\" + ch if ch in ".^$*+?()[]{}|\\" else ch for ch in value)


def _rank(query: str):
    """
    Ранг: точное вхождение в НАЗВАНИЕ весит больше, чем в описании, а похожесть
    добавляется сверху. Гость, набравший «сакура», ждёт заведение «Сакура»
    первым, а не блюдо, где это слово в составе.
    """
    lowered = query.lower()
    return WordSimilarity(Value(lowered), F("title_hay")) * Value(2.0) + F("typo")


def _visible_items(hotel, settings: SearchSettings) -> QuerySet:
    """
    Позиции, которые гость МОЖЕТ увидеть в приложении.

    Скрытое, выключенное и лежащее в выключенном заведении в выдачу не
    попадает: найти то, чего нельзя заказать, хуже, чем не найти ничего.
    """
    from apps.catalog.models import Item

    queryset = Item.objects.filter(
        is_active=True,
        category__is_active=True,
    ).select_related("category", "category__service").prefetch_related("images__asset")
    # Заведение выключено или спрятано от гостя — вместе с ним уходит и меню.
    queryset = queryset.filter(
        Q(category__service__isnull=True)
        | Q(category__service__is_active=True, category__service__is_guest_facing=True)
    )
    if settings.excluded_services:
        queryset = queryset.exclude(category__service__code__in=settings.excluded_services)
    return queryset


def _item_extra_match(query: str) -> Q:
    """
    Совпадение в СОСТАВЕ, характеристиках и модификаторах.

    Состав лежит в `attributes.nutrition.composition`, характеристики и
    модификаторы — отдельными таблицами. Гость ищет «трюфель» и должен найти
    картофель с трюфелем, даже если слово есть только в составе, — это прямое
    требование, а не бонус.
    """
    lowered = query.lower()
    return (
        Q(attributes__icontains=lowered)
        | Q(characteristics__name__icontains=lowered)
        | Q(characteristics__value__icontains=lowered)
        | Q(modifier_groups__title__icontains=lowered)
        | Q(modifier_groups__options__title__icontains=lowered)
    )


def search(hotel, query: str, *, language: str | None = None, limit: int = GROUP_LIMIT) -> dict:
    """
    Поиск по всему, что отель показывает гостю. Результат сгруппирован по типу.

    Короткий запрос не ищем вовсе: на одном символе совпадёт половина меню, и
    гость получит не ответ, а шум.
    """
    from apps.hotels.models import Service

    text = (query or "").strip()
    settings = SearchSettings.of(hotel)
    empty = {"query": text, "services": [], "items": [], "info": [], "total": 0}
    if len(text) < MIN_QUERY:
        return empty

    condition, typo = _matches(text)

    groups: dict[str, list] = {"services": [], "items": [], "info": []}

    if settings.services:
        services = (
            Service.objects.filter(is_active=True, is_guest_facing=True)
            .exclude(code__in=settings.excluded_services)
            .select_related("execution_point", "image")
            .annotate(
                haystack=_haystack("public_name", "tagline"),
                title_hay=_haystack("public_name"),
            )
            .annotate(typo=typo)
            .filter(condition)
            .annotate(rank=_rank(text))
            .order_by("-rank", "sort_order")[:limit]
        )
        groups["services"] = [_service_row(service, language) for service in services]

    if settings.items or settings.info:
        items = (
            _visible_items(hotel, settings)
            .annotate(
                haystack=_haystack("title", "description", "content"),
                title_hay=_haystack("title"),
            )
            .annotate(typo=typo)
            .filter(condition | _item_extra_match(text))
            .annotate(rank=_rank(text))
            .order_by("-rank", "sort_order")
            .distinct()[: limit * 2]
        )
        for item in items:
            bucket = "info" if _is_info(item) else "items"
            if bucket == "items" and not settings.items:
                continue
            if bucket == "info" and not settings.info:
                continue
            if len(groups[bucket]) >= limit:
                continue
            groups[bucket].append(_item_row(item, language))

    total = sum(len(rows) for rows in groups.values())
    return {"query": text, **groups, "total": total}


def _is_info(item) -> bool:
    from apps.catalog.models import OfferingType

    return item.type == OfferingType.INFO or item.category.type == OfferingType.INFO


def _service_image(service) -> str | None:
    from apps.media.services import image_url

    return image_url(getattr(service, "image", None), variant="card") or None


def _item_image(item) -> str | None:
    """
    Первый кадр позиции. У позиции их несколько (`images`), а не одно поле —
    в выдачу идёт первый, тот же, что показывает карточка.
    """
    from apps.media.services import image_url

    for link in item.images.all():
        url = image_url(link.asset, variant="card")
        if url:
            return url
    return None


def _service_row(service, language: str | None) -> dict:
    return {
        "kind": "service",
        "code": service.code,
        "title": translate(service.public_title, language) or service.code,
        "subtitle": translate(service.tagline, language) or "",
        # Маршрут витрины: тап ведёт В ЗАВЕДЕНИЕ, а не в список заведений.
        "route": f"/venue/{service.code}",
        "image": _service_image(service),
    }


def _item_row(item, language: str | None) -> dict:
    from apps.catalog.models import OfferingType

    service = item.category.service
    return {
        "kind": "info" if _is_info(item) else "item",
        "code": item.code,
        "id": str(item.pk),
        "title": translate(item.title, language) or item.code,
        "subtitle": translate(item.description, language) or "",
        # Откуда позиция — гость помнит блюдо, но не помнит заведение; это
        # ровно то, ради чего поиск и заводился.
        "venue": translate(service.public_title, language) if service else "",
        "venue_code": service.code if service else "",
        # ПРЯМО В КАРТОЧКУ, а не в список: витрина открывает меню заведения с
        # раскрытой позицией по `?item=`.
        #
        # В параметре ИДЕНТИФИКАТОР, а не код. Витрина спрашивает позицию у
        # сервера ровно этим значением, и код она читает как испорченный UUID —
        # экран открывался с трассировкой вместо блюда.
        "route": (
            f"/info?item={item.pk}"
            if item.type == OfferingType.INFO
            else (f"/venue/{service.code}?item={item.pk}" if service else f"/menu?item={item.pk}")
        ),
        "image": _item_image(item),
        "price": item.price,
    }
