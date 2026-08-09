"""
Роли внутри отеля и их область.

Три уровня (карта продукта, Часть 3):

* **линейный персонал** — повар, бармен, горничная, консьерж, спа-мастер.
  Видит трекер своих точек и двигает задачи. Меню, цены, расписания,
  настройки — нет. В CMS его вообще не пускают.
* **управляющий сервисом** — тот же человек с `StaffAssignment.level=manager`.
  Правит наполнение, расписание, коммерцию, персонал и видит аналитику
  СВОИХ сервисов. В чужие сервисы и в настройки отеля не лезет.
* **администратор отеля** (`User.is_hotel_admin`) — вся CMS.

**Почему уровень привязки, а не новое поле роли.** `StaffAssignment.Level` уже
содержал `member / lead / manager`, и на `manager` уже опирался движок
эскалации (`TargetKind.MANAGER` — «поднять руководителю отдела»). Заводить
рядом второй признак «управляющий» означало бы два источника правды о том, кто
старший в отделе, и первое же расхождение между ними было бы тихим: эскалация
ушла бы одному человеку, права достались бы другому.

**Область управляющего — это его точки исполнения.** Сервис и исполнитель
связаны 1:1 (R1), поэтому «свои сервисы» и «свои точки» — одно и то же
множество, и проверка везде сводится к одному вопросу: принадлежит ли объект
точке, которой человек управляет.

**Где стоят проверки.** Грубый гейт — на входе в CMS (`CmsAuth`): линейного
дальше не пускают вовсе. Точечные — в СЕРВИСНОМ слое, а не во вьюхах: у CMS
около сотни эндпоинтов, и правило «не забыть проверку в новой вьюхе» не
работает. Проверка стоит в местах, через которые объект вообще достаётся из
базы (`get_item`, `get_category`, `get_rule`, …) — мимо них к объекту не
пройти.
"""

from __future__ import annotations

import dataclasses

from apps.core.context import current_actor
from apps.core.errors import PermissionDenied

from apps.accounts.models import StaffAssignment


class NotMyService(PermissionDenied):
    code = "not_my_service"


class NoCmsAccess(PermissionDenied):
    code = "no_cms_access"


class HotelAdminOnly(PermissionDenied):
    code = "hotel_admin_only"


@dataclasses.dataclass(frozen=True, slots=True)
class Access:
    # Актора нет вовсе: сид, management-команда, Celery-задача, миграция.
    # Такой вызов идёт не из запроса, и ограничивать его ролью нечем и незачем —
    # он уже внутри доверенной границы. Инвариант, на котором это держится:
    # ЛЮБОЙ HTTP-путь проставляет актора в классе аутентификации до того, как
    # управление дойдёт до сервисного слоя (StaffAuth.authenticate). Неавториз.
    # запрос до сервисного слоя не доходит — его отсекает 401.
    is_system: bool
    is_platform_admin: bool
    is_hotel_admin: bool
    # Точки, которыми человек УПРАВЛЯЕТ (level=manager).
    managed_point_ids: frozenset[str]
    # Все точки, к которым он привязан, — область трекера.
    member_point_ids: frozenset[str]

    @property
    def is_service_manager(self) -> bool:
        return bool(self.managed_point_ids)

    @property
    def is_line_staff(self) -> bool:
        return not self.is_hotel_admin and not self.is_service_manager

    @property
    def has_cms_access(self) -> bool:
        """Админ отеля — всюду; управляющий — в свой сервис; линейный — никуда."""
        return self.is_system or self.is_hotel_admin or self.is_service_manager

    @property
    def unrestricted(self) -> bool:
        return self.is_system or self.is_hotel_admin

    def manages_point(self, point_id) -> bool:
        return self.unrestricted or str(point_id) in self.managed_point_ids

    def payload(self) -> dict:
        """Что фронт должен знать о своих правах, не гадая по эндпоинтам."""
        if self.is_hotel_admin:
            role = "hotel_admin"
        elif self.is_service_manager:
            role = "service_manager"
        else:
            role = "line_staff"
        return {
            "role": role,
            "has_cms_access": self.has_cms_access,
            "managed_point_ids": sorted(self.managed_point_ids),
            "member_point_ids": sorted(self.member_point_ids),
        }


SYSTEM = Access(
    is_system=True,
    is_platform_admin=False,
    is_hotel_admin=False,
    managed_point_ids=frozenset(),
    member_point_ids=frozenset(),
)


def access_for(user) -> Access:
    if user is None:
        return SYSTEM
    if getattr(user, "is_platform_admin", False):
        # Платформенный админ проваливается в отель как его администратор.
        return Access(
            is_system=False,
            is_platform_admin=True,
            is_hotel_admin=True,
            managed_point_ids=frozenset(),
            member_point_ids=frozenset(),
        )

    rows = list(
        StaffAssignment.objects.filter(user=user, is_active=True).values_list(
            "execution_point_id", "level"
        )
    )
    return Access(
        is_system=False,
        is_platform_admin=False,
        is_hotel_admin=bool(getattr(user, "is_hotel_admin", False)),
        managed_point_ids=frozenset(
            str(point_id)
            for point_id, level in rows
            if level == StaffAssignment.Level.MANAGER
        ),
        member_point_ids=frozenset(str(point_id) for point_id, _ in rows),
    )


def current_access() -> Access:
    """
    Права текущего актора. Актора кладёт в контекст класс аутентификации —
    сервисному слою не нужно протаскивать `user` через десяток сигнатур.
    """
    return access_for(current_actor())


# --- Проверки --------------------------------------------------------------


def require_cms_access() -> Access:
    access = current_access()
    if not access.has_cms_access:
        raise NoCmsAccess(
            "Раздел управления доступен администратору отеля и управляющим сервисами"
        )
    return access


def require_hotel_admin() -> Access:
    """
    Уровень отеля: бренд, номера, локации, отделы, справочники, витрина,
    валюта и налог. Управляющий сюда не ходит — это общее всему отелю, а не
    его сервису.
    """
    access = current_access()
    if not access.unrestricted:
        raise HotelAdminOnly(
            "Это настройка уровня отеля — её меняет администратор отеля"
        )
    return access


def require_point_scope(point_id, *, what: str = "Этот объект") -> Access:
    """Объект принадлежит точке исполнения — управляющий обязан ею управлять."""
    access = current_access()
    if not access.manages_point(point_id):
        raise NotMyService(f"{what} относится к сервису, которым вы не управляете")
    return access


def require_service_scope(service, *, what: str = "Этот объект") -> Access:
    if service is None:
        # Объект без сервиса (не привязанная категория, правило отеля по
        # умолчанию) — уровень отеля по определению.
        return require_hotel_admin()
    return require_point_scope(service.execution_point_id, what=what)


def managed_point_ids_or_none() -> list[str] | None:
    """
    Чем фильтровать списки. None = не фильтровать (админ отеля и системный
    вызов видят всё); список — точки управляющего.
    """
    access = current_access()
    return None if access.unrestricted else sorted(access.managed_point_ids)
