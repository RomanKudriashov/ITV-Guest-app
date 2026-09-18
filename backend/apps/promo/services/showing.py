"""
Кого показать гостю: правила показа, приоритет, один баннер на экран.

ПОКАЗ СЧИТАЕТСЯ ОДИН РАЗ НА СЕССИЮ. Витрина перерисовывается на каждом
переходе; показ на перерисовку превратил бы CTR в ложь — знаменатель рос бы
от того, что гость ходит по меню. Отсюда одна строка `BannerView` на пару
«баннер + сессия», и уникальное ограничение стережёт это на уровне базы.

«ПЕРВЫЙ ВХОД» — это сессия, которой ещё не показывали НИ ОДНОГО баннера.
Определение выбрано так, чтобы его можно было проверить: «первый раз в отеле»
мы знать не можем (гость приходит без регистрации, с чужого устройства), а
«первый экран этой сессии» — знаем точно. Считается ДО записи показа, иначе
правило отменило бы само себя.
"""

from __future__ import annotations

from datetime import time

from django.db.models import Q
from django.utils import timezone

from apps.promo.models import Banner, BannerView


def _fits_dates(banner: Banner, today) -> bool:
    if banner.starts_on and today < banner.starts_on:
        return False
    if banner.ends_on and today > banner.ends_on:
        return False
    return True


def _fits_time(banner: Banner, now: time) -> bool:
    """
    Окно суток. Через полночь (22:00–06:00) — это объединение двух отрезков, а
    не пустое множество: «ночью» — законное пожелание отеля.
    """
    start, end = banner.time_from, banner.time_to
    if start is None and end is None:
        return True
    start = start or time(0, 0)
    end = end or time(23, 59, 59)
    if start <= end:
        return start <= now <= end
    return now >= start or now <= end


def _fits_language(banner: Banner, language: str) -> bool:
    wanted = [code for code in (banner.languages or []) if code]
    return not wanted or language in wanted


def _fits_room_category(banner: Banner, category_id) -> bool:
    wanted = [str(pk) for pk in banner.room_categories.values_list("pk", flat=True)]
    if not wanted:
        return True
    return category_id is not None and str(category_id) in wanted


def eligible(hotel, session, *, language: str):
    """
    Подходящие баннеры по убыванию приоритета. Закрытые и уже отработавшие
    правило «только первый вход» сюда не попадают.
    """
    local = hotel.local_now()
    seen_any = BannerView.objects.filter(session=session).exists()
    dismissed = set(
        BannerView.objects.filter(session=session, dismissed_at__isnull=False).values_list(
            "banner_id", flat=True
        )
    )
    category_id = session.room.category_id if session.room_id else None

    rows = (
        Banner.objects.filter(is_active=True)
        .filter(Q(starts_on__isnull=True) | Q(starts_on__lte=local.date()))
        .filter(Q(ends_on__isnull=True) | Q(ends_on__gte=local.date()))
        .prefetch_related("images__asset", "room_categories")
        .order_by("-priority", "created_at")
    )
    out = []
    for banner in rows:
        if banner.pk in dismissed:
            continue
        if banner.first_visit_only and seen_any:
            continue
        if not _fits_dates(banner, local.date()):
            continue
        if not _fits_time(banner, local.time()):
            continue
        if not _fits_language(banner, language):
            continue
        if not _fits_room_category(banner, category_id):
            continue
        out.append(banner)
    return out


def pick_for(hotel, session, *, language: str) -> Banner | None:
    """ОДИН баннер на экран, не больше. Совпали правила — решает приоритет."""
    rows = eligible(hotel, session, language=language)
    return rows[0] if rows else None


def record_view(banner: Banner, session, *, language: str) -> BannerView:
    """
    Отметить показ. Повтор ничего не меняет: строка одна на сессию, и второй
    заход на витрину не двоит знаменатель CTR.
    """
    category = ""
    if session.room_id and session.room.category_id:
        category = session.room.category.code
    view, _ = BannerView.objects.get_or_create(
        hotel_id=banner.hotel_id,
        banner=banner,
        session=session,
        defaults={"language": language, "room_category": category},
    )
    return view


def record_click(banner_id, session) -> BannerView | None:
    """Нажатие. Считаем каждое: гость может вернуться к баннеру и нажать снова."""
    from django.db.models import F

    view = BannerView.objects.filter(banner_id=banner_id, session=session).first()
    if view is None:
        return None
    BannerView.objects.filter(pk=view.pk).update(
        clicks=F("clicks") + 1, last_click_at=timezone.now(), updated_at=timezone.now()
    )
    view.refresh_from_db()
    return view


def dismiss(banner_id, session) -> bool:
    """Закрыть. В этой сессии баннер больше не вернётся — это состояние сервера."""
    view = BannerView.objects.filter(banner_id=banner_id, session=session).first()
    if view is None:
        return False
    if view.dismissed_at is None:
        BannerView.objects.filter(pk=view.pk).update(
            dismissed_at=timezone.now(), updated_at=timezone.now()
        )
    return True
