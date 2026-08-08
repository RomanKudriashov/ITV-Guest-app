"""
Индексы под глобальный поиск гостя.

ТРИГРАММЫ, А НЕ ПОЛНОТЕКСТОВЫЙ ИНДЕКС. Поиск обязан находить по началу слова, с
опечатками и подстрокой — включая письмо без пробелов между словами. Первое и
третье полнотекстовый индекс не умеет вовсе, второе — только со словарями на
каждый язык. GIN по триграммам закрывает все три и один на все языки.

Индексы стоят на ТЕХ ЖЕ выражениях, которыми ищет `apps/catalog/search.py`:
`lower(поле::text)` по JSONB отдаёт все переводы разом. Разойдись выражение с
индексом — запрос останется правильным, но пойдёт последовательным чтением, и
заметить это можно будет только по времени ответа.
"""

from django.contrib.postgres.operations import TrigramExtension
from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("catalog", "0010_service_inclusion")]

    operations = [
        TrigramExtension(),
        migrations.RunSQL(
            sql=[
                # Позиции: название, описание, тело инфо-страницы и атрибуты
                # (в них лежит состав).
                """
                CREATE INDEX IF NOT EXISTS catalog_item_search_trgm
                ON catalog_item USING gin (
                    lower(title::text || ' ' || description::text || ' ' ||
                          content::text || ' ' || attributes::text)
                    gin_trgm_ops
                )
                """,
                # Заведения: гостевое название и подпись.
                """
                CREATE INDEX IF NOT EXISTS hotels_service_search_trgm
                ON hotels_service USING gin (
                    lower(public_name::text || ' ' || tagline::text) gin_trgm_ops
                )
                """,
                # Характеристики и модификаторы — отдельные таблицы, и по ним
                # тоже ищут: «гриль» стоит в характеристике, а не в описании.
                """
                CREATE INDEX IF NOT EXISTS catalog_characteristic_search_trgm
                ON catalog_item_characteristic USING gin (
                    lower(name::text || ' ' || value::text) gin_trgm_ops
                )
                """,
                """
                CREATE INDEX IF NOT EXISTS catalog_modifier_option_search_trgm
                ON catalog_modifier_option USING gin (lower(title::text) gin_trgm_ops)
                """,
            ],
            reverse_sql=[
                "DROP INDEX IF EXISTS catalog_item_search_trgm",
                "DROP INDEX IF EXISTS hotels_service_search_trgm",
                "DROP INDEX IF EXISTS catalog_characteristic_search_trgm",
                "DROP INDEX IF EXISTS catalog_modifier_option_search_trgm",
            ],
        ),
    ]
