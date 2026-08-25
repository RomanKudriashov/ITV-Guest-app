"""
Права платформенных ручек: одна точка, закрытая по умолчанию.

ЗАЧЕМ. Право проверялось поручно, в теле каждой вьюхи, и это работало ровно
до первой забытой строки. Забытых оказалось шесть из одиннадцати изменяющих:
роль «только чтение» переименовывала отель, меняла ему тариф, гасила его
гостям, заводила новые отели, выгружала персональные данные и сбрасывала
пароль администратора отеля — получая новый пароль в ответе, то есть полный
доступ в чужую CMS.

Поручная проверка не чинится добавлением шести строк: седьмая ручка приедет
без неё так же, как приехали эти. Поэтому право теперь ОБЪЯВЛЯЕТСЯ, а
отсутствие объявления означает отказ.

КАК УСТРОЕНО.

* `@requires(...)` рядом с ручкой — объявление и проверка в одном месте.
  Отдельного списка «путь → право» нет намеренно: список живёт в другом файле,
  расходится с кодом и врёт молча.
* `PlatformRouter` — рубеж по умолчанию. Ручка, зарегистрированная без
  объявления, подменяется отказом: не «пропустим, раз не сказано», а «не
  сказано — значит нельзя».
* Незнакомое или пустое право — тоже отказ. Опечатка в имени права обязана
  запирать дверь, а не открывать её настежь.
* Аутентификация осталась в `PlatformAuth` и сюда не переехала: тот отвечает
  «кто пришёл», этот — «что ему можно». Два вопроса, два места.

ПОРЯДОК ДЕКОРАТОРОВ ВАЖЕН. `@requires` идёт ПОД `@router.…`, иначе в роутер
попадёт необъявленная функция и рубеж честно её запрёт:

    @router.post("/hotels")
    @requires(WRITE)
    def create_hotel(request, payload): ...
"""

from __future__ import annotations

from functools import wraps

from ninja import Router
from ninja.operation import AsyncOperation, Operation

from apps.accounts.services.platform_access import can_write, is_owner
from apps.core.errors import PermissionDenied

# Публичная ручка: вход. Объявляется ЯВНО — «публичность» это решение, а не
# следствие того, что про право забыли.
PUBLIC = "public"
# Любой аутентифицированный член команды платформы, включая «только чтение».
READ = "read"
# Тоже любой аутентифицированный, но ручка меняет ТОЛЬКО ЕГО САМОГО: свой
# второй фактор, свой профиль. Отдельно от READ, потому что READ на
# изменяющей ручке — это ошибка, а здесь изменение законно и ограничено
# собственной учётной записью.
SELF = "self"
# Поддержка и владелец.
WRITE = "write"
# Только владелец: деньги, состав команды, необратимое.
OWNER = "owner"

_PREDICATES = {
    PUBLIC: lambda user: True,
    READ: lambda user: True,
    SELF: lambda user: True,
    WRITE: can_write,
    OWNER: is_owner,
}

# Права, которыми МОЖНО закрыть изменяющую ручку. `READ` сюда не входит
# намеренно: объявить POST правом «read» — это тихо открыть его наблюдателю,
# и такую ошибку обязана ловить охранная проверка, а не отзыв из продакшена.
MUTATING_RIGHTS = frozenset({PUBLIC, SELF, WRITE, OWNER})

# Человеческие названия для отказа. Гостю платформы важно не «forbidden», а
# что именно у него за роль и чего ей не хватает.
_DENIED_TEXT = {
    WRITE: "Роль «только чтение» ничего не меняет",
    OWNER: "Действие доступно только владельцу платформы",
}

ATTR = "_platform_right"


def requires(right: str):
    """
    Объявить право ручки.

    Декоратор НЕ оборачивает функцию, а только помечает её. Обёртка здесь
    стоила бы разбора сигнатуры: ninja достаёт типы аргументов через
    `get_type_hints`, а тот резолвит строковые аннотации (в модулях включён
    `from __future__ import annotations`) по `__globals__` функции. У обёртки
    из этого файла в globals нет ни `PlatformLoginIn`, ни прочих схем, и
    сборка OpenAPI разваливается на `PydanticUserError`.

    Поэтому пометка — здесь, а проверка — в `PlatformRouter`, уже после того
    как ninja разобрал настоящую функцию.
    """

    def decorate(view):
        setattr(view, ATTR, right)
        return view

    return decorate


def declared_right(view) -> str:
    """Объявленное право ручки. Пусто — не объявлено."""
    return getattr(view, ATTR, "") or ""


class PlatformRouter(Router):
    """
    Роутер, который не пускает необъявленное.

    Проверка навешивается ПОСЛЕ регистрации: ninja к этому моменту уже
    разобрал сигнатуру настоящей функции и построил модели, и подмена
    исполняемой части ему безразлична.

    Ручка без объявления не роняет импорт (иначе приложение не поднялось бы
    из-за одной забытой строки — и рубеж сняли бы первым же коммитом «чтобы
    завелось»), а отвечает отказом. Найти такую обязана девятая проверка сети
    безопасности; до тех пор она заперта, а не открыта.
    """

    def add_api_operation(self, path: str, methods, view_func, **kwargs):
        result = super().add_api_operation(path, methods, view_func, **kwargs)
        operation = self.path_operations[path].operations[-1]
        operation.view_func = _guarded(view_func, path, methods)
        _check_before_parsing(operation, path, methods)
        return result


def _denial(right: str, user, path: str, methods) -> PermissionDenied | None:
    """Отказ, если он положен, — иначе None. Одна формулировка на два рубежа."""
    if not right:
        return PermissionDenied(
            f"У ручки {'/'.join(methods)} {path} не объявлено право доступа",
            code="right_undeclared",
        )
    predicate = _PREDICATES.get(right)
    if predicate is None:
        # Незнакомое право — отказ. Иначе опечатка в имени открывала бы ручку
        # всем: «нет правила» слишком легко прочитать как «нет ограничений».
        return PermissionDenied(
            f"Право «{right}» не объявлено в реестре прав платформы",
            code="right_unknown",
        )
    if not predicate(user):
        return PermissionDenied(_DENIED_TEXT.get(right, "Недостаточно прав"), code="forbidden")
    return None


class _RightsChecked(Operation):
    """
    ОТКАЗ РАНЬШЕ РАЗБОРА ТЕЛА.

    Право проверялось в исполняемой части ручки, то есть ПОСЛЕ того, как ninja
    разобрал и провалидировал тело. Наблюдатель, дёрнувший изменяющую ручку,
    получал 422 «тело не то» вместо 403: сначала мы читали его файл, и только
    потом отказывали. На загрузке ПНР это означало разбор чужого Excel в пользу
    того, кому ручка не положена вовсе.

    `_run_checks` — правильный шов: аутентификация к этому моменту уже прошла
    (`PlatformAuth` выставляет `request.user`), а тела никто не касался.

    ПОЧЕМУ ПОДМЕНА КЛАССА, А НЕ ОБЁРТКА МЕТОДА. При монтировании роутера ninja
    клонирует операции через `object.__new__(self.__class__)` и переносит
    фиксированный список полей — обёртка, положенная в атрибут экземпляра, до
    боевого объекта не доезжает и молча пропадает. Класс переживает клон, а
    право берётся из `view_func`, который в этот список входит.
    """

    def _run_checks(self, request):
        error = super()._run_checks(request)
        if error is not None:
            return error
        denial = _denial(
            declared_right(self.view_func),
            getattr(request, "user", None),
            self.path,
            self.methods,
        )
        if denial is not None:
            # Отказ отдаём тем же обработчиком, что и прочие доменные ошибки:
            # формат отказа один на всю платформу.
            return self.api.on_exception(request, denial)
        return None


class _AsyncRightsChecked(AsyncOperation):
    """То же для асинхронных ручек: их у платформы пока нет, но появятся."""

    async def _run_checks(self, request):
        error = await super()._run_checks(request)
        if error is not None:
            return error
        denial = _denial(
            declared_right(self.view_func),
            getattr(request, "user", None),
            self.path,
            self.methods,
        )
        if denial is not None:
            return self.api.on_exception(request, denial)
        return None


def _check_before_parsing(operation, path: str, methods) -> None:
    """
    Поставить ранний рубеж на уже зарегистрированную операцию.

    Проверка в `_guarded` при этом ОСТАЁТСЯ вторым рубежом: если ninja
    переименует внутренний метод, ранний шов отвалится молча, и дверь удержит
    он. Охранная проверка `test_every_platform_route_refuses_read_only` такую
    поломку показывает — она требует 403 и на запросе без валидного тела.
    """
    if isinstance(operation, AsyncOperation):
        operation.__class__ = _AsyncRightsChecked
    else:
        operation.__class__ = _RightsChecked


def _guarded(view, path: str, methods):
    """Исполняемая часть ручки, закрытая объявленным правом."""
    right = declared_right(view)

    @wraps(view)
    def guarded(request, *args, **kwargs):
        denial = _denial(right, getattr(request, "user", None), path, methods)
        if denial is not None:
            raise denial
        return view(request, *args, **kwargs)

    # Пометку переносим: охранная проверка смотрит на то, что реально
    # зарегистрировано, а не на исходник — декоратор мог быть написан и не
    # примениться.
    setattr(guarded, ATTR, right)
    return guarded
