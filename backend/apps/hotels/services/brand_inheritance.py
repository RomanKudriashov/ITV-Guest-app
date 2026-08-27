"""
Тема отеля и пресет библиотеки — пара-копия общего механизма.

ОГОВОРКА, КОТОРАЯ ЗДЕСЬ ГЛАВНЕЕ КОДА.

У справочника «разошлось» — плохая новость: аллергены должны быть одинаковыми
у всех, и отличие означает, что где-то что-то пропустили. У оформления всё
наоборот. Отель, перекрасивший витрину под свой бренд, сделал ровно то, чего от
него ждут; он не «разошёлся с эталоном», у него СВОЁ ОФОРМЛЕНИЕ.

Поэтому здесь нет ни слова «расхождение», ни кнопки «вернуть к эталону» на
видном месте. Экран, предлагающий починить неполоманное, приучает нажимать
«ок» не глядя — и однажды этим «ок» снесут работу дизайнера отеля.

Что здесь всё-таки нужно платформе: знать, СКОЛЬКО отелей живёт на нашем
пресете без правок. Это ответ на вопрос «если мы поправим пресет, кого это
коснётся» — и он же граница, за которой правка библиотеки становится
бессмысленной.

СОСТОЯНИЯ, ПЕРЕВЕДЁННЫЕ НА ЯЗЫК ОФОРМЛЕНИЯ:

    следует за пресетом   — тема совпадает с библиотечной (State.MISSING/…
                            не используются: сравниваем целиком)
    своё оформление       — тема собрана из пресета и изменена (State.CHANGED)
    своя тема             — происхождение не записано (State.EXTRA)

Третье — не «неизвестно», а честное «источника нет». Такие темы у отелей,
заведённых до появления поля происхождения, и у тех, кто собрал оформление
сам. Обещать им наследование было бы неправдой.
"""

from __future__ import annotations

from apps.core.context import tenant_context
from apps.hotels import brand_library
from apps.hotels.models import BrandTheme, Hotel
from apps.hotels.services import inheritance

#: Как состояние называется на экране. Список здесь, а не на фронте: те же
#: слова уходят в отчёт платформы, и два словаря разошлись бы.
LABELS = {
    "follows": "следует за пресетом",
    inheritance.State.CHANGED.value: "своё оформление",
    inheritance.State.EXTRA.value: "своя тема",
}


def state_of(theme: BrandTheme) -> str:
    """
    Одно из трёх. Никаких «расхождений» — см. докстроку модуля.

    Сравниваем токены ЦЕЛИКОМ: у темы нет полей, отличие в которых не считалось
    бы правкой оформления, — в этом её отличие от записи справочника, где
    порядок сортировки к содержанию отношения не имеет.
    """
    if not theme.source_preset:
        return inheritance.State.EXTRA.value
    source = brand_library.preset_tokens(theme.source_preset)
    if source is None:
        # Пресет из библиотеки убрали, а тема на него ссылается. Это «своя
        # тема»: следовать больше не за чем, и притворяться, что есть, нельзя.
        return inheritance.State.EXTRA.value
    return "follows" if inheritance.is_untouched(theme.tokens, source) else inheritance.State.CHANGED.value


def report(*, limit: int | None = None) -> dict:
    """
    Кто на каком оформлении. Для платформы — «кого коснётся правка пресета».
    """
    hotels = Hotel.objects.all()
    if limit:
        hotels = hotels[:limit]

    rows = []
    counts = {"follows": 0, inheritance.State.CHANGED.value: 0, inheritance.State.EXTRA.value: 0}
    for hotel in hotels:
        with tenant_context(hotel):
            theme = BrandTheme.objects.filter(is_preset=False).order_by("name").first()
        state = state_of(theme) if theme is not None else inheritance.State.EXTRA.value
        counts[state] += 1
        rows.append(
            {
                "hotel_id": str(hotel.pk),
                "name": hotel.name_i18n,
                "subdomain": hotel.subdomain,
                "theme": theme.name if theme else None,
                "preset": theme.source_preset if theme else "",
                "state": state,
                "label": LABELS[state],
            }
        )

    return {
        "hotels": rows,
        "counts": counts,
        # Ради этого числа отчёт и открывают: правка пресета доедет только до
        # тех, кто за ним следует.
        "would_be_affected": counts["follows"],
        "total_hotels": len(rows),
    }


def look_of_current_hotel() -> dict:
    """
    Ответ отелю про его собственное оформление.

    Живёт здесь, а не во вьюхе: выборка — работа сервиса (структурный сторож
    `test_views_do_not_touch_orm` ловит обратное). Заодно ярлык берётся из
    одного словаря с платформенным отчётом — двум сторонам про одно и то же
    полагается говорить одним словом.
    """
    theme = BrandTheme.objects.filter(is_preset=False).order_by("name").first()
    if theme is None:
        state = inheritance.State.EXTRA.value
        return {"state": state, "label": LABELS[state], "preset": "", "theme": None}
    state = state_of(theme)
    return {
        "state": state,
        "label": LABELS[state],
        "preset": theme.source_preset,
        "theme": theme.name,
    }


def affected_by(preset: str) -> list[str]:
    """
    Отели, до которых доедет правка данного пресета.

    Отдельная функция, а не фильтр отчёта: её спрашивают ПЕРЕД правкой, и
    ответ на неё — предупреждение, а не статистика.
    """
    affected = []
    for hotel in Hotel.objects.all():
        with tenant_context(hotel):
            theme = BrandTheme.objects.filter(is_preset=False, source_preset=preset).first()
        if theme is not None and state_of(theme) == "follows":
            affected.append(str(hotel.pk))
    return affected
