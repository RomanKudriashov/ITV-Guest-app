"""
Сторожа миграций.

ЖИВЫЕ ДУБЛИ ПЕРЕД УСЛОВНЫМ ИНДЕКСОМ (партия 44, п.76). Уникальность кодов
переезжает на «только среди живых» (`condition=deleted_at IS NULL`). Прежний
безусловный индекс дублей не допускал вовсе, так что живых дублей быть не
должно, — но если они есть (ручная правка базы, старая выгрузка), создание
индекса упадёт посреди миграции невнятной ошибкой Postgres. Сторож проверяет
заранее и называет, что именно мешает.

ОБХОД ПО ОТЕЛЯМ, а не один запрос. Под обычной ролью тенантные таблицы под RLS
отдают ноль строк без `tenant_context` — проверка «прошла» бы вхолостую.
Под платформенной ролью (BYPASSRLS) видно всё, поэтому отель задаётся ещё и
явным фильтром: так проверка одинакова под обеими ролями.
"""

from __future__ import annotations

from django.db.models import Count


def assert_no_live_duplicates(specs: list[tuple[str, str, tuple[str, ...]]]):
    """
    Вернуть функцию для `RunPython`: падает, если среди ЖИВЫХ строк есть дубли.

    `specs` — список (приложение, модель, поля ключа без `hotel`).
    """

    def check(apps, schema_editor):
        from apps.core.context import tenant_context

        db = schema_editor.connection.alias
        Hotel = apps.get_model("hotels", "Hotel")
        found: list[str] = []
        for hotel in Hotel._base_manager.using(db).all():
            with tenant_context(hotel.pk):
                for app_label, model_name, fields in specs:
                    model = apps.get_model(app_label, model_name)
                    rows = (
                        model._base_manager.using(db)
                        .filter(hotel_id=hotel.pk, deleted_at__isnull=True)
                        .values(*fields)
                        .annotate(n=Count("id"))
                        .filter(n__gt=1)
                    )
                    for row in rows:
                        key = ", ".join(f"{f}={row[f]}" for f in fields)
                        found.append(f"{hotel.subdomain}: {model_name} ({key}) — живых {row['n']}")
        if found:
            raise RuntimeError(
                "Условный индекс уникальности не создать: среди ЖИВЫХ записей есть дубли. "
                "Разберите их (оставьте одну живую), затем повторите миграцию:\n  "
                + "\n  ".join(found)
            )

    return check
