"""
Автоперевод без модели (пункт 32 заказчика).

Механизм построен целиком, кроме самого вызова: очередь, отчёт, учёт расхода,
защита ручной правки и правило имён собственных. Модель подключается заменой
слоя — одной строкой настроек.

ГЛАВНОЕ, ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ: без модели поля остаются ПУСТЫМИ. Заглушка,
похожая на перевод, уехала бы в публикацию и стала бы витриной отеля.
"""

from __future__ import annotations

import pytest

from apps.catalog.models import Item
from apps.core.context import tenant_context
from apps.translate.models import TranslationMark, TranslationRun, TranslationUsage
from apps.translate.services.coverage import coverage, looks_like
from apps.translate.services.runner import execute, queue_run
from tests.translate.fakes import FakeProvider

pytestmark = pytest.mark.django_db

FAKE = "tests.translate.fakes.FakeProvider"
BROKEN = "tests.translate.fakes.BrokenProvider"


@pytest.fixture(autouse=True)
def _no_calls():
    FakeProvider.calls = []
    yield
    FakeProvider.calls = []


@pytest.fixture
def dish(crystal):
    """Одна позиция под нашим присмотром: перевода у неё нет ни на одном языке."""
    with tenant_context(crystal):
        item = Item.objects.filter(title__has_key="ru").first()
        item.title = {"ru": "Салат овощной"}
        item.description = {"ru": "Огурцы и помидоры"}
        item.save(update_fields=["title", "description", "updated_at"])
        return item.pk


def _run(crystal, languages=("en",), groups=("позиции",)):
    with tenant_context(crystal):
        run = TranslationRun.objects.create(
            hotel_id=crystal.id,
            languages=list(languages),
            groups=list(groups),
        )
        return execute(run)


def _title(crystal, item_id):
    with tenant_context(crystal):
        return Item.objects.get(pk=item_id).title


# --- Без модели ----------------------------------------------------------------


def test_without_a_model_the_fields_stay_empty(crystal, dish, settings):
    """Без модели — ни одного записанного символа. Это и есть весь смысл пункта."""
    settings.TRANSLATION_PROVIDER = "none"
    run = _run(crystal)
    assert run.translated == 0
    assert run.skipped >= 1
    assert "en" not in _title(crystal, dish), "пустое поле честнее похожего на перевод"
    assert "Автоперевод пока не подключён" in "".join(run.report["reasons"])


def test_the_button_says_it_plainly(cms, crystal, settings):
    """Кнопка не делает вид, что запустила: отказ с прямым текстом."""
    settings.TRANSLATION_PROVIDER = "none"
    response = cms.post("/api/cms/translate/runs", {"languages": ["en"]})
    assert response.status_code == 409, response.content
    body = response.json()
    assert body["code"] == "translation_not_connected"
    assert body["detail"] == "Автоперевод пока не подключён"


def test_coverage_works_without_any_model(cms, crystal, settings):
    settings.TRANSLATION_PROVIDER = "none"
    body = cms.get("/api/cms/translate/coverage?languages=en,ar").json()
    assert body["provider"] == {"name": "none", "connected": False}
    by_language = {row["language"]: row for row in body["languages"]}
    assert set(by_language) == {"en", "ar"}
    assert by_language["en"]["total"] > 0, "охват считается по живым данным, а не по модели"
    assert by_language["en"]["filled"] + by_language["en"]["missing"] == by_language["en"]["total"]


# --- Счётчик говорит правду ------------------------------------------------------


def test_russian_under_the_english_key_is_not_a_translation(crystal, dish):
    """
    Главная ложь счётчика: «в ключе что-то лежит» ≠ «переведено». Гость увидел
    бы кириллицу в английской витрине, а отчёт сказал бы «всё готово».
    """
    with tenant_context(crystal):
        item = Item.objects.get(pk=dish)
        item.title = {"ru": "Салат овощной", "en": "Салат овощной"}
        item.save(update_fields=["title", "updated_at"])
        rows = {row["language"]: row for row in coverage(["en"], groups=["позиции"])}
    assert rows["en"]["suspicious"] >= 1, "русский под ключом en — не перевод"


def test_a_proper_noun_in_latin_is_a_real_translation(crystal, dish):
    """«Sakura» под арабским ключом написано латиницей намеренно — это не дыра."""
    with tenant_context(crystal):
        item = Item.objects.get(pk=dish)
        item.title = {"ru": "Сакура", "ar": "Sakura"}
        item.save(update_fields=["title", "updated_at"])
        rows = {row["language"]: row for row in coverage(["ar"], groups=["позиции"])}
    assert rows["ar"]["suspicious"] == 0
    assert rows["ar"]["filled"] >= 1


def test_an_empty_source_is_not_counted_as_a_gap(crystal, dish):
    """«12 из 70» считается по тому, что вообще есть на языке отеля."""
    with tenant_context(crystal):
        item = Item.objects.get(pk=dish)
        item.description = {}
        item.save(update_fields=["description", "updated_at"])
        with_empty = coverage(["en"], groups=["позиции"])[0]["total"]
        item.description = {"ru": "Огурцы и помидоры"}
        item.save(update_fields=["description", "updated_at"])
        with_text = coverage(["en"], groups=["позиции"])[0]["total"]
    assert with_text == with_empty + 1


@pytest.mark.parametrize(
    "language,text,expected",
    [
        ("en", "Vegetable salad", True),
        ("en", "Салат овощной", False),
        ("ar", "سلطة", True),
        ("ar", "Салат", False),
        ("ar", "Vegetable salad", False),
        ("zh", "蔬菜沙拉", True),
        ("zh", "Салат", False),
    ],
)
def test_the_script_check_reads_the_letters(language, text, expected):
    assert looks_like(language, text) is expected


# --- С моделью: механизм вокруг вызова ------------------------------------------


def test_with_a_model_the_value_lands_and_gets_a_mark(crystal, dish, settings):
    settings.TRANSLATION_PROVIDER = FAKE
    run = _run(crystal)
    assert run.translated >= 2, run.report
    assert _title(crystal, dish)["en"] == "[en] Салат овощной"
    with tenant_context(crystal):
        assert TranslationMark.objects.filter(object_id=dish, field="title", language="en").exists()


def test_a_human_edit_beats_the_machine(crystal, dish, settings):
    """Повторный автоперевод НЕ затирает исправленное человеком — никогда."""
    settings.TRANSLATION_PROVIDER = FAKE
    _run(crystal)
    with tenant_context(crystal):
        item = Item.objects.get(pk=dish)
        item.title = {**item.title, "en": "Garden salad"}
        item.save(update_fields=["title", "updated_at"])

    second = _run(crystal)
    assert _title(crystal, dish)["en"] == "Garden salad", "машина затёрла правку человека"
    assert "правка человека" in second.report["reasons"]


def test_a_second_run_does_not_pay_for_the_same_text_twice(crystal, dish, settings):
    settings.TRANSLATION_PROVIDER = FAKE
    first = _run(crystal)
    calls_after_first = len(FakeProvider.calls)
    second = _run(crystal)
    assert len(FakeProvider.calls) == calls_after_first, "второй прогон снова платил модели"
    assert second.translated == 0
    assert second.characters == 0
    assert "уже переведено машиной" in second.report["reasons"]
    assert first.characters > 0


def test_a_changed_source_refreshes_the_machine_value(crystal, dish, settings):
    """Исходник переписали — перевод устарел, и обновить его не значит затереть."""
    settings.TRANSLATION_PROVIDER = FAKE
    _run(crystal)
    with tenant_context(crystal):
        item = Item.objects.get(pk=dish)
        item.title = {**item.title, "ru": "Салат греческий"}
        item.save(update_fields=["title", "updated_at"])
    _run(crystal)
    assert _title(crystal, dish)["en"] == "[en] Салат греческий"


def test_a_proper_noun_is_carried_over_without_calling_the_model(crystal, dish, settings):
    """«Сакура» переводить нечем и незачем: слово переносится, счёт не растёт."""
    settings.TRANSLATION_PROVIDER = FAKE
    with tenant_context(crystal):
        item = Item.objects.get(pk=dish)
        item.title = {"ru": "Сакура"}
        item.description = {}
        item.save(update_fields=["title", "description", "updated_at"])
    run = _run(crystal)
    assert _title(crystal, dish)["en"] == "Сакура"
    assert all(request.text != "Сакура" for request in FakeProvider.calls)
    assert "имя собственное" in run.report["reasons"]


def test_the_model_is_told_which_words_to_keep(crystal, dish, settings):
    """Имя внутри фразы переводить нельзя: модель получает список охраняемых слов."""
    settings.TRANSLATION_PROVIDER = FAKE
    with tenant_context(crystal):
        item = Item.objects.get(pk=dish)
        item.title = {"ru": "Ресторан «Панорама»"}
        item.description = {}
        item.save(update_fields=["title", "description", "updated_at"])
    _run(crystal)
    asked = [request for request in FakeProvider.calls if "Панорама" in request.text]
    assert asked and "Панорама" in asked[0].keep


def test_a_hotel_adds_its_own_names_to_the_rule(crystal, dish, settings):
    """Правило одно, но список пополняет отель: имена у каждого свои."""
    settings.TRANSLATION_PROVIDER = FAKE
    with tenant_context(crystal):
        crystal.settings = {**(crystal.settings or {}), "translation": {"keep": ["Витязь"]}}
        crystal.save(update_fields=["settings", "updated_at"])
        item = Item.objects.get(pk=dish)
        item.title = {"ru": "Витязь"}
        item.description = {}
        item.save(update_fields=["title", "description", "updated_at"])
    _run(crystal)
    assert _title(crystal, dish)["en"] == "Витязь"


def test_a_broken_model_does_not_stop_the_run(crystal, dish, settings):
    settings.TRANSLATION_PROVIDER = BROKEN
    run = _run(crystal)
    assert run.status == TranslationRun.Status.DONE
    assert run.failed >= 1
    assert run.report["errors"][0]["error"].startswith("модель вернула мусор")
    assert "en" not in _title(crystal, dish)


# --- Расход ----------------------------------------------------------------------


def test_the_bill_is_counted_per_hotel_and_month(crystal, dish, settings):
    """Без учёта один большой каталог съест бюджет флота, и узнают по счёту."""
    settings.TRANSLATION_PROVIDER = FAKE
    run = _run(crystal)
    with tenant_context(crystal):
        usage = TranslationUsage.objects.get()
        assert usage.calls == len(FakeProvider.calls)
        assert usage.characters == run.characters > 0
        before = usage.characters
        Item.objects.filter(pk=dish).update(title={"ru": "Салат новый"})
    _run(crystal)
    with tenant_context(crystal):
        assert TranslationUsage.objects.get().characters > before, "расход копится за месяц"


def test_usage_is_reported_to_the_hotel(cms, crystal, dish, settings):
    settings.TRANSLATION_PROVIDER = FAKE
    _run(crystal)
    rows = cms.get("/api/cms/translate/usage").json()["items"]
    assert rows and rows[0]["calls"] > 0 and rows[0]["characters"] > 0


# --- Очередь и отчёт -------------------------------------------------------------


def test_the_run_is_queued_and_reported(cms, crystal, settings):
    settings.TRANSLATION_PROVIDER = FAKE
    started = cms.post("/api/cms/translate/runs", {"languages": ["en"], "groups": ["метки"]})
    assert started.status_code == 200, started.content
    run_id = started.json()["id"]
    report = cms.get(f"/api/cms/translate/runs/{run_id}").json()
    assert report["languages"] == ["en"]
    assert report["status"] in ("queued", "running", "done")
    assert any(row["id"] == run_id for row in cms.get("/api/cms/translate/runs").json()["items"])


def test_the_queue_hands_the_work_to_the_worker(
    crystal, settings, monkeypatch, django_capture_on_commit_callbacks
):
    """
    Каталог отеля — тысячи значений: оператора на открытой вкладке не держим.
    Задача уходит ПОСЛЕ фиксации: воркер не должен увидеть строку прогона
    раньше, чем она появилась в базе.
    """
    settings.TRANSLATION_PROVIDER = FAKE
    sent = []
    monkeypatch.setattr(
        "apps.translate.services.runner._dispatch", lambda run_id, hotel_id: sent.append(run_id)
    )
    with tenant_context(crystal):
        with django_capture_on_commit_callbacks(execute=True):
            run = queue_run(languages=["en"], groups=["метки"])
            assert run.status == TranslationRun.Status.QUEUED
            assert sent == [], "задача ушла до фиксации — воркер не найдёт строку"
    assert sent == [run.pk], "прогон не ушёл в очередь"


def test_the_report_says_what_was_skipped_and_why(crystal, dish, settings):
    settings.TRANSLATION_PROVIDER = FAKE
    _run(crystal)
    second = _run(crystal)
    assert sum(second.report["reasons"].values()) == second.skipped
    assert second.report["provider"] == "fake"
