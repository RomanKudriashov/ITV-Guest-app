"""
Кто отвечает в диалоге — «отвечает Дарья» у остальных.

НЕ БЛОКИРОВКА. Любой сотрудник ресепшена может открыть занятый диалог и
написать: держатель от этого не меняется, но все видят, что диалог ведут.
Перехватить можно явно («Взять себе»).

КОГДА ДИАЛОГ ОСВОБОЖДАЕТСЯ. Смен в системе нет, и «ушёл со смены» напрямую
не наблюдается. Наблюдается три вещи, и каждая освобождает:
  * держатель сам закрыл диалог или перешёл к другому — явное «отпустить»;
  * вход держателя закрыт — вышел, сессию погасили, учётку выключили;
  * держатель давно не появлялся в диалоге — HOLD_MINUTES без открытия,
    обновления и ответа. Это закрытый ноутбук и ушедший домой без выхода.
Таймаут — последний рубеж, а не основной механизм: «занято» дольше
четверти часа без признаков жизни хуже, чем свободный диалог — гость ждёт,
а смена думает, что им занимаются.

Проверка живая, в момент чтения: освобождение не требует фоновой задачи и
не может «не сработать».
"""

from __future__ import annotations

from datetime import timedelta

from django.utils import timezone

from apps.chat.models import ChatThread

HOLD_MINUTES = 15


def active_holder(thread: ChatThread, now=None):
    """Держатель, если он ещё держит; иначе None."""
    from apps.accounts.models import StaffSession

    if thread.holder_id is None or thread.holder_seen_at is None:
        return None
    now = now or timezone.now()
    if thread.holder_seen_at < now - timedelta(minutes=HOLD_MINUTES):
        return None
    user = thread.holder
    if user is None or not user.is_active:
        return None
    live = StaffSession.objects.filter(
        user_id=user.pk, revoked_at__isnull=True, expires_at__gt=now
    ).exists()
    return user if live else None


def holder_payload(thread: ChatThread, me=None, now=None) -> dict | None:
    user = active_holder(thread, now)
    if user is None:
        return None
    return {
        "id": str(user.pk),
        "name": user.full_name or user.email,
        "is_me": bool(me is not None and user.pk == me.pk),
    }


def touch(thread: ChatThread, user, *, force: bool = False) -> None:
    """
    Отметиться в диалоге. Свободный — взять; свой — продлить; чужой —
    только с `force` («Взять себе»), иначе держатель не меняется.
    """
    now = timezone.now()
    holder = active_holder(thread, now)
    if holder is not None and holder.pk != user.pk and not force:
        return
    ChatThread.objects.filter(pk=thread.pk).update(holder=user, holder_seen_at=now)
    thread.holder = user
    thread.holder_id = user.pk
    thread.holder_seen_at = now


def handover_by_id(thread: ChatThread, *, user_id, by_user) -> None:
    """
    Передать по идентификатору. Проверка «кому можно» и выборка человека —
    здесь: вьюха не ходит в базу, и правило доступа живёт в одном месте с
    самой передачей, а не рядом с ней.
    """
    from apps.accounts.models import User
    from apps.chat.services.threads import handover_targets
    from apps.core.errors import ValidationError

    if str(user_id) not in {row["id"] for row in handover_targets(by_user)}:
        raise ValidationError(
            "Этому сотруднику передать нельзя: он не ведёт переписку с гостями",
            field="user_id",
            code="handover_not_allowed",
        )
    handover(thread, to_user=User.objects.get(pk=user_id), by_user=by_user)


def handover(thread: ChatThread, *, to_user, by_user) -> None:
    """
    Передать диалог ПОИМЁННО.

    До этого отдать переписку можно было только отделу — «Поручением», — либо
    ждать, пока коллега перехватит её сам. Обе дороги отвечают «пусть
    кто-нибудь займётся», а у смены ресепшена это и есть способ потерять
    гостя: каждый думает, что взял другой.

    Передача делает три вещи и все три обязательны:
      * держателем становится тот, кому передали;
      * в переписке остаётся строка о передаче — иначе следующий читающий не
        поймёт, почему отвечает другой человек;
      * адресат получает уведомление ЛИЧНО. Отдел здесь не адресат.
    """
    from apps.chat.services.threads import staff_send
    from apps.notifications.services.events import notify

    now = timezone.now()
    ChatThread.objects.filter(pk=thread.pk).update(holder=to_user, holder_seen_at=now)
    thread.holder = to_user
    thread.holder_id = to_user.pk
    thread.holder_seen_at = now

    from_name = by_user.full_name or by_user.email
    to_name = to_user.full_name or to_user.email
    # Строка видна и гостю: он читает, что его вопросом занялся другой
    # человек, а не что разговор оборвался.
    staff_send(thread, by_user, f"Диалог передан: {to_name}")

    last = thread.messages.order_by("-created_at").first()
    notify(
        "chat.handover",
        {
            "room_number": getattr(getattr(thread, "guest_session", None), "room", None)
            and thread.guest_session.room.number,
            "from_name": from_name,
            "preview": (getattr(last, "body", "") or "")[:160],
        },
        user_id=to_user.pk,
        dedupe_key=f"chat.handover:{thread.pk}:{to_user.pk}:{int(now.timestamp())}",
    )


def release(thread: ChatThread, user) -> None:
    """Отпустить свой диалог. Чужой так не отпускается — только перехватом."""
    if thread.holder_id == user.pk:
        ChatThread.objects.filter(pk=thread.pk, holder=user).update(holder=None, holder_seen_at=None)
        thread.holder = None
        thread.holder_id = None
        thread.holder_seen_at = None
