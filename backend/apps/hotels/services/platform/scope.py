"""
ОБЛАСТЬ ЧЛЕНА КОМАНДЫ ПЛАТФОРМЫ: к каким отелям он имеет отношение.

ВТОРАЯ ОСЬ, А НЕ НОВАЯ РОЛЬ. Право отвечает «что можно» (владелец, поддержка,
только чтение), область — «над кем». Роль «администратор сети» это не третье
право, а поддержка с областью из одной группы: иначе к каждой новой роли
пришлось бы заводить её копию с ограничением.

ОБЛАСТЬ РЕЖЕТ ВЫДАЧУ, А НЕ ТОЛЬКО ДЕЙСТВИЯ. Это главное правило файла. Человек,
который видит чужие отели и не может их тронуть, получает худший вид «только
чтения»: сам список чужих клиентов — уже утечка, и никакой отказ на кнопке её
не отменяет. Поэтому область применяется к ВЫБОРКАМ, а отказ на действии —
второй рубеж, а не первый.

ВЛАДЕЛЕЦ НЕ ОГРАНИЧИВАЕТСЯ НИКОГДА. Иначе платформа умеет запереть сама себя:
владелец, случайно оставленный с областью из удалённой группы, теряет доступ к
собственному флоту, и вернуть его будет некому.

НЕТ СТРОК ОБЛАСТИ — НЕТ ОГРАНИЧЕНИЯ. Пустая область означает «весь флот», то
есть ровно сегодняшнее поведение: ни одна существующая учётка не меняет смысла
от появления этой оси. «Ограничен нулём групп» выразить нельзя намеренно — это
учётка, которая ничего не видит, и заводить её незачем.
"""

from __future__ import annotations

from apps.accounts.services.platform_access import is_owner


def group_ids(user) -> list:
    """Группы области. Пусто — ограничения нет."""
    from apps.hotels.models import PlatformScopeGroup

    if user is None or is_owner(user):
        return []
    return list(
        PlatformScopeGroup.objects.filter(user_id=user.pk).values_list("group_id", flat=True)
    )


def is_limited(user) -> bool:
    return bool(group_ids(user))


def allowed_hotel_ids(user) -> set | None:
    """
    Отели области. `None` — ограничения нет (владелец или пустая область).

    Состав групп считается ПЕРЕСЧЁТОМ, тем же кодом, что режет флот: у
    группы-правила он вычисляемый, и хранимая копия разошлась бы с правдой на
    первом же заведённом отеле.
    """
    from apps.hotels.models import HotelGroup
    from apps.hotels.services.platform import groups as groups_svc

    ids = group_ids(user)
    if not ids:
        return None

    allowed: set = set()
    for group in HotelGroup.objects.filter(pk__in=ids):
        allowed.update(groups_svc.hotel_ids(group))
    return allowed


def limit_queryset(user, queryset, *, field: str = "pk"):
    """
    Сузить выборку до области.

    `field` — путь до отеля в этой модели (`pk` у самого отеля, `hotel_id` у
    узла, записи журнала и прочего). Пустая область — выборка возвращается как
    есть, без лишнего условия.
    """
    allowed = allowed_hotel_ids(user)
    if allowed is None:
        return queryset
    return queryset.filter(**{f"{field}__in": allowed})


def allows(user, hotel_id) -> bool:
    """
    Сравниваем СТРОКАМИ: из адреса приходит текст, из базы — UUID, и прямое
    сравнение молча давало бы «не разрешено» вообще всем.
    """
    allowed = allowed_hotel_ids(user)
    if allowed is None:
        return True
    return str(hotel_id) in {str(item) for item in allowed}


def assert_allows(user, hotel_id) -> None:
    """
    Отель вне области — 404, А НЕ 403.

    Отказ означал бы «такой отель есть, но вам нельзя», то есть подтверждал бы
    существование чужого клиента. Для этого человека такого отеля нет.
    """
    from apps.core.errors import NotFoundError

    if not allows(user, hotel_id):
        raise NotFoundError("Отель не найден")


def describe(user) -> dict:
    """Область для экрана: чем ограничен человек и сколько отелей видит."""
    from apps.hotels.models import HotelGroup

    ids = group_ids(user)
    if not ids:
        return {"limited": False, "groups": [], "hotels": None}

    groups = list(HotelGroup.objects.filter(pk__in=ids))
    allowed = allowed_hotel_ids(user) or set()
    return {
        "limited": True,
        "groups": [{"id": str(group.pk), "title": group.title} for group in groups],
        "hotels": len(allowed),
    }


def intersect(user, hotel_ids) -> tuple[list, int]:
    """
    Пересечение цели с областью — и СКОЛЬКО ОТСЕКЛИ.

    Второе число не для красоты: человек, публикующий в группу шире своей
    области, должен увидеть это ДО нажатия, а не узнать по отчёту, в котором
    половины отелей просто нет.
    """
    allowed = allowed_hotel_ids(user)
    ids = list(hotel_ids)
    if allowed is None:
        return ids, 0
    allowed_text = {str(item) for item in allowed}
    inside = [hid for hid in ids if str(hid) in allowed_text]
    return inside, len(ids) - len(inside)
