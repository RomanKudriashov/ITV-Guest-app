"""
Пользователи платформы и их журнал.

Раздел назывался «Команда», и слово путало: в системе оно значит ещё и приказ
оборудованию номера — в журнале два разных смысла стояли рядом. Имена модуля,
таблиц и КОДЫ ДЕЙСТВИЙ (`platform.team.invited`) оставлены прежними: коды уже
записаны в аудите, и переименование обнулило бы историю.

Участник команды — это User с `is_platform_admin` и без отеля. Отдельной модели
нет намеренно: иначе у нас появилось бы два вида «людей, которые входят», с
двумя разными механизмами пароля, блокировки и 2FA, — и однажды один из них
отстал бы от другого в вопросах безопасности.

Роль хранится в `platform_role` и означает право, а не должность:
владелец правит всё, поддержка ведёт отели и входит в них, «только чтение»
смотрит. Проверяют роль функции apps/accounts/platform_access.py — здесь только
хранение и выборка.
"""

from __future__ import annotations

import secrets

from django.contrib.auth.hashers import make_password

from django.db.models import Q

from apps.accounts.models import User
from apps.core.context import platform_scope
from apps.core.errors import NotFoundError, ValidationError
from apps.core.models import AuditLog
from apps.hotels.models import Hotel

VALID_ROLES = set(User.PlatformRole.values)


def _team_sorts() -> dict:
    """Столбцы «Команды» (партия 62-F): роль — по силе, доступ и 2FA — «есть» выше."""
    from django.db.models import Case, IntegerField, Value, When
    from django.db.models.functions import NullIf

    from apps.core.listing import russian

    def flag(field: str):
        return Case(When(**{field: True}, then=Value(0)), default=Value(1), output_field=IntegerField())

    return {
        "member": russian("email"),
        "name": NullIf(russian("full_name"), Value("")),
        "role": Case(
            *(When(platform_role=code, then=Value(i)) for i, code in enumerate(("owner", "support", "read_only"))),
            default=Value(9),
            output_field=IntegerField(),
        ),
        "access": flag("is_active"),
        "twofa": flag("totp_enabled"),
    }


def list_members(
    *,
    limit: int | None = None,
    search: str = "",
    user=None,
    role: str = "",
    active: str = "",
    twofa: str = "",
    sort: str = "",
    direction: str = "",
) -> dict:
    """
    Команда платформы. Растёт медленно, но предел здесь всё равно осознанный:
    выдача без предела — это обещание «столько и есть», которое однажды
    перестанет быть правдой молча.
    """
    from apps.hotels.services.platform.paging import clamp, envelope

    from apps.core.listing import search as apply_search

    limit = clamp(limit)
    with platform_scope():
        # `all_objects` — единственный способ увидеть платформенных: у них
        # `hotel = NULL`, и тенантный менеджер их не отдаёт. Но этот менеджер
        # отдаёт «всё как есть, и удалённых тоже» (см. его докстроку), поэтому
        # удалённых отсекаем ЯВНО.
        #
        # Без этого фильтра выдача копила удалённых вечно. На стенде их
        # набралось 155 при двух живых: предел в сто записей выбирался мусором,
        # настоящие учётки с него вытеснялись, и проверка «в команде есть
        # platform@itv.local» падала так, будто сломалась консоль.
        queryset = User.all_objects.using("platform").filter(
            is_platform_admin=True, hotel__isnull=True, deleted_at__isnull=True
        )
        # ОБЛАСТЬ (партия 60): ограниченный группами видит себя и тех, чья
        # область пересекается с его, — а не всю команду платформы с её
        # владельцами и чужими группами.
        from apps.hotels.services.platform import scope

        groups = scope.group_ids(user)
        if groups:
            from django.db.models import Q

            from apps.hotels.models import PlatformScopeGroup

            peers = PlatformScopeGroup.objects.using("platform").filter(group_id__in=groups).values("user_id")
            queryset = queryset.filter(Q(pk__in=peers) | Q(pk=user.pk))
        # По почте и имени — по ним человека в команде и ищут.
        queryset = apply_search(queryset, search, ("email", "full_name"))
        # Фильтры — на сервере, значения через запятую, как в адресе (62-D).
        roles = [r for r in role.split(",") if r]
        if roles:
            queryset = queryset.filter(platform_role__in=roles)
        flags = {"yes": True, "no": False}
        states = {flags[v] for v in active.split(",") if v in flags}
        if len(states) == 1:
            queryset = queryset.filter(is_active=states.pop())
        factors = {flags[v] for v in twofa.split(",") if v in flags}
        if len(factors) == 1:
            queryset = queryset.filter(totp_enabled=factors.pop())
        total = queryset.count()
        from apps.core.listing import order

        members = list(order(queryset, sort, direction, _team_sorts(), default=("email",), then=("email", "pk"))[:limit])
    rows = [
        {
            "id": str(member.pk),
            "email": member.email,
            "full_name": member.full_name,
            "role": member.platform_role,
            "is_active": member.is_active,
            "totp_enabled": member.totp_enabled,
        }
        for member in members
    ]
    return envelope(rows, total, limit)


def invite(*, email: str, role: str, full_name: str = "") -> tuple[User, str]:
    """
    Приглашение в команду. Пароль генерируется и отдаётся один раз: платформа
    заводит доступ, но не должна оставаться его хранителем.
    """
    email = (email or "").strip().lower()
    if "@" not in email:
        raise ValidationError("Нужен корректный email", field="email")
    if role not in VALID_ROLES:
        raise ValidationError(f"Неизвестная роль «{role}»", field="role")

    password = secrets.token_urlsafe(12)
    with platform_scope():
        existing = User.all_objects.using("platform").filter(email=email).first()
        if existing is not None:
            raise ValidationError("Такой пользователь уже есть", field="email")
        member = User.all_objects.using("platform").create(
            email=email,
            full_name=full_name.strip(),
            password=make_password(password),
            hotel=None,
            is_platform_admin=True,
            is_staff_member=False,
            platform_role=role,
        )
    return member, password


def update_member(user_id: str, *, role: str | None, is_active: bool | None, actor_id) -> User:
    with platform_scope():
        member = (
            User.all_objects.using("platform")
            .filter(pk=user_id, is_platform_admin=True, hotel__isnull=True)
            .first()
        )
        if member is None:
            raise NotFoundError("Участник не найден")

        fields: dict = {}
        if role is not None:
            if role not in VALID_ROLES:
                raise ValidationError(f"Неизвестная роль «{role}»", field="role")
            fields["platform_role"] = role
        if is_active is not None:
            # Владелец не может отключить или разжаловать сам себя: платформа,
            # оставшаяся без единого владельца, не чинится изнутри.
            if str(member.pk) == str(actor_id) and not is_active:
                raise ValidationError("Нельзя отключить самого себя", field="is_active")
            fields["is_active"] = is_active
        if role is not None and str(member.pk) == str(actor_id) and role != User.PlatformRole.OWNER:
            raise ValidationError("Нельзя снять с себя роль владельца", field="role")

        if fields:
            deactivated = fields.get("is_active") is False and member.is_active
            User.all_objects.using("platform").filter(pk=member.pk).update(**fields)
            for key, value in fields.items():
                setattr(member, key, value)
            if deactivated:
                # Отключённый участник — без живых входов в консоль: иначе они
                # висят в реестре, а выйти из-под отключённого нельзя.
                from apps.accounts.services import sessions as session_svc

                session_svc.revoke_all(member.pk, scope="platform", reason="deactivated")
    return member



def reset_two_factor(*, email: str | None = None, user_id: str | None = None, actor_id=None) -> User:
    """
    Снять второй фактор с учётки Control (партия 60).

    Два входа и одно действие: владелец — участнику из «Пользователей»
    (себе — нельзя), и команда `manage.py reset_platform_2fa` на сервере — для
    того, у кого сбросить некому (единственный владелец потерял телефон).
    Секрет стирается целиком: включить снова можно только заново, кодом.
    Все входы участника обрываются — сброс означает, что фактор, возможно, в
    чужих руках, и сессии, открытые с ним, больше не наши.
    """
    from apps.accounts.services import sessions as session_svc

    with platform_scope():
        queryset = User.all_objects.using("platform").filter(
            is_platform_admin=True, hotel__isnull=True, deleted_at__isnull=True
        )
        member = (
            queryset.filter(email=email.strip().lower()).first()
            if email
            else queryset.filter(pk=user_id).first()
        )
        if member is None:
            raise NotFoundError("Участник не найден")
        if actor_id is not None and str(member.pk) == str(actor_id):
            raise ValidationError(
                "Себе второй фактор сбрасывают только командой на сервере — "
                "иначе его снимал бы любой, у кого открыта ваша сессия",
                field="user_id",
                code="self_reset",
            )
        User.all_objects.using("platform").filter(pk=member.pk).update(totp_enabled=False, totp_secret="")
        member.totp_enabled, member.totp_secret = False, ""
    session_svc.revoke_all(member.pk, scope="platform", reason="2fa_reset")
    return member


def audit_feed(
    *,
    limit: int = 100,
    cursor: str | None = None,
    hotel_id: str | None = None,
    action: str | None = None,
    since: str | None = None,
    until: str | None = None,
    search: str | None = None,
    who: str | None = None,
    group_id: str | None = None,
    period: str | None = None,
    view: str | None = None,
    sort: str | None = None,
    direction: str | None = None,
    user=None,
) -> dict:
    """
    Журнал платформы: и действия без отеля (вход, команда, 2FA), и действия
    НАД отелями. Одним списком — вопрос к этому экрану звучит «кто что делал».

    ЛИСТАНИЕ КУРСОРОМ, А НЕ СМЕЩЕНИЕМ: журнал пополняется прямо во время
    просмотра, и смещение показало бы часть первой страницы второй раз.
    Курсор составной (`время|id`): массовая операция пишет десятки строк в
    одну миллисекунду.

    ФИЛЬТРЫ — НА СЕРВЕРЕ (партия 62-D): кто, действие, отель, группа, период,
    текст; вид «Входы поддержки». Значения — через запятую, как в адресе.
    Старые дубли (одно действие, записанное дважды) в выдачу не попадают.
    """
    from apps.hotels.services.platform import journal

    limit = max(1, min(limit, 500))
    split = lambda value: [v for v in (value or "").split(",") if v]  # noqa: E731

    with platform_scope():
        queryset = (
            AuditLog.all_objects.using("platform")
            .filter(actor_type=AuditLog.ActorType.PLATFORM)
            .exclude(action__in=journal.LEGACY_DUPLICATES)
        )
        # ОБЛАСТЬ РЕЖЕТ ЖУРНАЛ: администратор группы видит действия по СВОИМ
        # отелям, а внутреннюю жизнь платформы (вход, 2FA, команда) — нет.
        from apps.hotels.services.platform import scope as scope_svc

        allowed = scope_svc.allowed_hotel_ids(user)
        if allowed is not None:
            queryset = queryset.filter(hotel_id__in=allowed)

        if view == "support":
            queryset = queryset.filter(action__startswith="impersonation.")
        actions = split(action)
        if actions:
            queryset = queryset.filter(action__in=actions)
        hotels = split(hotel_id)
        groups = split(group_id)
        if groups:
            from apps.hotels.models import HotelGroupMember

            hotels += [
                str(pk)
                for pk in HotelGroupMember.objects.using("platform")
                .filter(group_id__in=groups, group__deleted_at__isnull=True)
                .values_list("hotel_id", flat=True)
            ] or ["00000000-0000-0000-0000-000000000000"]
        if hotels:
            queryset = queryset.filter(hotel_id__in=hotels)
        people = split(who)
        if people:
            queryset = queryset.filter(actor_id__in=people)
        start_at = journal.period_start(period or "") or journal.moment(since)
        end_at = journal.moment(until)
        if start_at:
            queryset = queryset.filter(created_at__gte=start_at)
        if end_at:
            queryset = queryset.filter(created_at__lte=end_at)
        term = (search or "").strip()
        if term:
            # Отель ищется по поддомену и названию, человек — по почте и имени,
            # запись — по своему содержимому.
            from django.db.models import TextField
            from django.db.models.functions import Cast

            matched = list(
                Hotel.all_objects.using("platform")
                .annotate(name_text=Cast("name", TextField()))
                .filter(Q(subdomain__icontains=term) | Q(former_subdomain__icontains=term) | Q(name_text__icontains=term))
                .values_list("pk", flat=True)
            )
            queryset = journal.text_filter(queryset, term, actor_ids=journal.matching_actors(term), hotel_ids=matched)

        total = queryset.count()
        rows, next_cursor = journal.page_rows(
            queryset, {"sort": sort, "dir": direction, "cursor": cursor}, limit=limit, with_hotel=True
        )

        hotel_ids = {row.hotel_id for row in rows if row.hotel_id}
        hotels_by_id = {item.pk: item for item in Hotel.all_objects.using("platform").filter(pk__in=hotel_ids)}

    people_by_id = journal.actors(row.actor_id for row in rows)
    items = []
    for row in rows:
        entry = journal.serialize(row, people_by_id)
        hotel = hotels_by_id.get(row.hotel_id)
        entry.update(
            {
                # Прежнее поле `actor` — почтой: его читают старые экраны.
                "actor": (people_by_id.get(row.actor_id) or {}).get("email", "—"),
                "actor_info": entry.pop("actor"),
                "hotel": hotel.name_i18n if hotel else None,
                "subdomain": (hotel.former_subdomain or hotel.subdomain) if hotel else None,
            }
        )
        items.append(entry)
    return {
        "items": items,
        "total": total,
        "limit": limit,
        "next_cursor": next_cursor,
    }


def audit_people() -> list[dict]:
    """Кто действовал в журнале — для фильтра «Кто»."""
    from apps.hotels.services.platform import journal

    with platform_scope():
        ids = set(
            AuditLog.all_objects.using("platform")
            .filter(actor_type=AuditLog.ActorType.PLATFORM, actor_id__isnull=False)
            .values_list("actor_id", flat=True)
            .distinct()
        )
    return sorted(journal.actors(ids).values(), key=lambda person: person["name"].lower())


def audit_actions() -> list[str]:
    """
    Список действий для фильтра — берётся из самого журнала.

    Захардкоженный перечень разошёлся бы с жизнью в первый же новый вид
    события, и фильтр молча перестал бы находить его записи.
    """
    with platform_scope():
        return sorted(
            AuditLog.all_objects.using("platform")
            .filter(actor_type=AuditLog.ActorType.PLATFORM)
            .exclude(action__in=("platform.hotel.entered", "grms.published", "grms.rolled_back"))
            .values_list("action", flat=True)
            .distinct()
        )
