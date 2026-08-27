"""
ТРИ ПАРЫ НА ОБЩЕМ МЕХАНИЗМЕ: коммерция сервиса, порог SLA точки, тема бренда.

Один укус на пару, и все три про одно: ПРАВКА ИСТОЧНИКА НЕ ПЕРЕТИРАЕТ ТО, ЧТО
ЗАДАЛ ОТЕЛЬ. Это единственное обещание механизма, которое нельзя нарушить
тихо: перетёртое значение выглядит как нормальная работа, а узнают о нём из
счёта гостя, из разбуженного ночью старшего и из перекрашенной витрины.

Плюс проверка, ради которой в ядре появилось отдельное состояние: значение,
выставленное руками РОВНО КАК У ИСТОЧНИКА, — это не наследование. Оно за
источником не пойдёт, и экран обязан показать его, а не спрятать как
«совпадает».
"""

from __future__ import annotations

import pytest

from apps.core.context import tenant_context
from apps.hotels.models import BrandTheme, ExecutionPoint, Hotel, Service
from apps.hotels.services import brand_inheritance, commerce_inheritance, inheritance, sla_inheritance

pytestmark = pytest.mark.django_db


# --- Коммерция сервиса ------------------------------------------------------


def test_hotel_fee_change_does_not_touch_a_service_with_its_own_fee(crystal):
    """
    УКУС. У отеля 10%, у бара свой 0%. Отель поднимает свой сбор до 15% —
    у бара обязан остаться 0%.

    Это деньги: перетёртый ноль превращает бесплатный бар в бар со сбором, и
    заметят это по счёту гостя, а не по логу.
    """
    hotel = crystal
    with tenant_context(hotel):
        bar = Service.objects.filter(code="bar").first()
        assert bar is not None
        bar.service_fee_bp = 0
        bar.save(update_fields=["service_fee_bp", "updated_at"])

    hotel.service_fee_bp = 1500
    hotel.save(update_fields=["service_fee_bp", "updated_at"])

    with tenant_context(hotel):
        bar.refresh_from_db()
        assert bar.service_fee_bp == 0, "правка отеля перетёрла собственный сбор заведения"
        assert bar.commerce_value(hotel, "service_fee_bp") == 0


def test_the_commerce_report_lists_services_with_their_own_values(crystal):
    """«У трёх заведений свой сбор» — списком, а не обходом карточек."""
    hotel = crystal
    # Условие задаём САМИ. Первая версия теста опиралась на сид и упала: у
    # фикстуры сбор отеля нулевой, ноль бара с ним совпадал, и состояние было
    # `pinned` — верно по коду, но проверяли мы не то, что думали.
    hotel.service_fee_bp = 1000
    hotel.save(update_fields=["service_fee_bp", "updated_at"])
    with tenant_context(hotel):
        bar = Service.objects.filter(code="bar").first()
        bar.service_fee_bp = 0
        bar.save(update_fields=["service_fee_bp", "updated_at"])

        report = commerce_inheritance.report(hotel)

    codes = {row["code"] for row in report["services"]}
    assert "bar" in codes
    assert report["with_own"] == len(report["services"])
    row = next(r for r in report["services"] if r["code"] == "bar")
    field = next(f for f in row["fields"] if f["field"] == "service_fee_bp")
    assert field["state"] == inheritance.State.CHANGED.value
    assert field["own"] == 0 and field["hotel"] == hotel.service_fee_bp


def test_a_value_set_to_the_same_number_is_shown_as_pinned(crystal):
    """
    Сбор, выставленный руками ровно как у отеля, — НЕ наследование.

    Отличия сегодня нет, но завтра отель поменяет своё, а это заведение
    останется на старом. Прятать такую строку значило бы прятать причину
    завтрашнего вопроса.
    """
    hotel = crystal
    with tenant_context(hotel):
        service = Service.objects.exclude(code="bar").first()
        service.service_fee_bp = hotel.service_fee_bp
        service.save(update_fields=["service_fee_bp", "updated_at"])

        report = commerce_inheritance.report(hotel)

    row = next(r for r in report["services"] if r["code"] == service.code)
    field = next(f for f in row["fields"] if f["field"] == "service_fee_bp")
    assert field["state"] == inheritance.State.PINNED.value
    assert row["counts"]["own"] >= 1


def test_reset_returns_a_service_to_inheritance_not_to_a_copy(crystal):
    """
    Возврат ставит NULL, а не копирует значение отеля.

    Скопированное значение — это тот же оверрайд под другим именем: экран
    очистился бы, а наследование не вернулось.
    """
    hotel = crystal
    with tenant_context(hotel):
        service = Service.objects.first()
        service.service_fee_bp = 777
        service.save(update_fields=["service_fee_bp", "updated_at"])

        assert commerce_inheritance.reset(hotel, [str(service.pk)], fields=["service_fee_bp"]) == 1
        service.refresh_from_db()
        assert service.service_fee_bp is None
        assert service.commerce_value(hotel, "service_fee_bp") == hotel.service_fee_bp


# --- Порог SLA точки --------------------------------------------------------


def test_the_sla_report_separates_overridden_from_inherited(crystal):
    """Экран «где переопределено» — и с чем сравнивать: сколько точек всего."""
    hotel = crystal
    with tenant_context(hotel):
        point = ExecutionPoint.objects.filter(is_active=True).first()
        point.sla_minutes = 5
        point.save(update_fields=["sla_minutes", "updated_at"])

        report = sla_inheritance.report()

    assert report["total_points"] >= 1
    assert report["overridden"] >= 1
    row = next(r for r in report["points"] if r["code"] == point.code)
    assert row["state"] == inheritance.State.CHANGED.value
    assert row["own_minutes"] == 5
    assert row["effective_minutes"] == 5
    assert row["default_minutes"] != 5 or row["state"] == inheritance.State.PINNED.value

    others = [r for r in report["points"] if r["own_minutes"] is None]
    assert all(r["state"] == "inherited" for r in others)
    assert all(r["effective_minutes"] == r["default_minutes"] for r in others)


def test_the_sla_report_agrees_with_the_board(crystal):
    """
    УКУС. Экран и доска обязаны говорить одно число.

    Своя копия правила в отчёте разошлась бы с `effective_sla_minutes()` молча:
    экран показывал бы двадцать, доска красила бы по пяти.
    """
    from apps.orders.services.tracker_types import effective_sla_minutes

    hotel = crystal
    with tenant_context(hotel):
        report = sla_inheritance.report()
        points = {str(p.pk): p for p in ExecutionPoint.objects.filter(is_active=True)}
        for row in report["points"]:
            assert row["effective_minutes"] == effective_sla_minutes(points[row["point_id"]])


def test_sla_reset_returns_to_the_kind_default(crystal):
    hotel = crystal
    with tenant_context(hotel):
        point = ExecutionPoint.objects.filter(is_active=True).first()
        point.sla_minutes = 5
        point.save(update_fields=["sla_minutes", "updated_at"])

        assert sla_inheritance.reset([str(point.pk)]) == 1
        point.refresh_from_db()
        assert point.sla_minutes is None


# --- Тема бренда ------------------------------------------------------------


def test_a_theme_copied_from_a_preset_follows_it(crystal):
    from apps.hotels import brand_library

    with tenant_context(crystal):
        theme = BrandTheme.objects.filter(is_preset=False).first()
        theme.source_preset = "midnight_navy"
        theme.tokens = brand_library.preset_tokens("midnight_navy")
        theme.save(update_fields=["source_preset", "tokens", "updated_at"])

        assert brand_inheritance.state_of(theme) == "follows"


def test_an_edited_theme_reads_as_its_own_look_not_as_a_divergence(crystal):
    """
    УКУС ФОРМУЛИРОВКИ. Перекрашенная витрина — это не поломка.

    Слово «расхождение» здесь предложило бы чинить неполоманное; экран,
    предлагающий починить работу дизайнера отеля, приучает нажимать «ок» не
    глядя. Проверяем именно ЯРЛЫК, а не только состояние.
    """
    from apps.hotels import brand_library

    with tenant_context(crystal):
        theme = BrandTheme.objects.filter(is_preset=False).first()
        theme.source_preset = "midnight_navy"
        tokens = dict(brand_library.preset_tokens("midnight_navy"))
        tokens["accent"] = {"soft": "#ff0000"}
        theme.tokens = tokens
        theme.save(update_fields=["source_preset", "tokens", "updated_at"])

        assert brand_inheritance.state_of(theme) == inheritance.State.CHANGED.value

    assert brand_inheritance.LABELS[inheritance.State.CHANGED.value] == "своё оформление"
    assert "расхожден" not in " ".join(brand_inheritance.LABELS.values()).lower()


def test_a_theme_without_origin_is_its_own_theme(crystal):
    """Происхождения нет — следовать не за чем, и обещать это нельзя."""
    with tenant_context(crystal):
        theme = BrandTheme.objects.filter(is_preset=False).first()
        theme.source_preset = ""
        theme.save(update_fields=["source_preset", "updated_at"])

        assert brand_inheritance.state_of(theme) == inheritance.State.EXTRA.value


def test_editing_the_library_preset_does_not_repaint_an_edited_hotel(crystal):
    """
    УКУС. Правка пресета библиотеки доезжает только до тех, кто за ним следует.

    Отель со своим оформлением в список затронутых не попадает — иначе правка
    библиотеки перекрасила бы витрину, которую отель делал сам.
    """
    from apps.hotels import brand_library

    with tenant_context(crystal):
        theme = BrandTheme.objects.filter(is_preset=False).first()
        theme.source_preset = "midnight_navy"
        tokens = dict(brand_library.preset_tokens("midnight_navy"))
        tokens["accent"] = {"soft": "#ff0000"}
        theme.tokens = tokens
        theme.save(update_fields=["source_preset", "tokens", "updated_at"])

    assert str(crystal.pk) not in brand_inheritance.affected_by("midnight_navy")

    with tenant_context(crystal):
        theme.tokens = brand_library.preset_tokens("midnight_navy")
        theme.save(update_fields=["tokens", "updated_at"])

    assert str(crystal.pk) in brand_inheritance.affected_by("midnight_navy")


# --- Ядро -------------------------------------------------------------------


def test_the_override_core_never_reports_an_unset_value():
    """
    NULL в выдачу не попадает вовсе: «не задано» — это наследование, а не
    состояние, о котором надо докладывать.
    """
    result = inheritance.classify_overrides({("fee",): 1000}, {})
    assert result == []


def test_the_override_core_tells_pinned_from_changed():
    same = inheritance.classify_overrides({("fee",): 1000}, {("fee",): 1000})
    other = inheritance.classify_overrides({("fee",): 1000}, {("fee",): 0})
    assert same[0].state is inheritance.State.PINNED
    assert other[0].state is inheritance.State.CHANGED


# --- Найдено по дороге ------------------------------------------------------


@pytest.mark.django_db(databases=["default", "platform"])
def test_the_platform_team_does_not_list_deleted_members(crystal):
    """
    УКУС. Удалённый участник уходит из списка команды.

    Выдача читает `all_objects` — иначе платформенных не видно вовсе (`hotel =
    NULL`, тенантный менеджер их не отдаёт). Но этот менеджер отдаёт и
    удалённых, а удаление в проекте мягкое, и фильтра не было.

    На стенде так накопилось 155 удалённых при двух живых: предел выдачи в сто
    записей выбирался мусором, настоящие учётки с него вытеснялись, и проверка
    консоли падала так, будто сломалась консоль. Сломались данные.
    """
    from apps.accounts.models import User
    from apps.core.context import platform_scope
    from apps.hotels.services.platform.team import list_members

    with platform_scope():
        gone = User.all_objects.using("platform").create(
            email="deleted-one@platform.test", is_platform_admin=True, hotel=None
        )
        gone.delete(using="platform")

        emails = {row["email"] for row in list_members()["items"]}

    assert "deleted-one@platform.test" not in emails, (
        "удалённый участник остался в команде — он будет копиться там вечно"
    )
