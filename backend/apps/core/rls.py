"""
Генерация SQL для Row-Level Security.

RLS здесь — не основной механизм изоляции, а страховка. Основной — TenantManager,
который скоупит запросы автоматически. RLS ловит то, что мимо него: raw SQL,
.all_objects, невнимательный ORM-запрос через related-менеджер.

Политика сравнивает hotel_id строки с сессионной переменной app.current_hotel.
Переменная не выставлена → current_setting(..., true) вернёт NULL → сравнение
NULL → строка не видна. Fail-closed by design.

FORCE ROW LEVEL SECURITY принципиален: без него владелец таблицы (роль, которой
прогоняли миграции) политику игнорирует. Обойти её может только роль с
атрибутом BYPASSRLS — платформенная.
"""

from __future__ import annotations

SESSION_VAR = "app.current_hotel"

_ENABLE = """
ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE {table} FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON {table};
CREATE POLICY tenant_isolation ON {table}
    USING ({column}::text = current_setting('%s', true))
    WITH CHECK ({column}::text = current_setting('%s', true));
""" % (SESSION_VAR, SESSION_VAR)

# Для таблиц, где отель необязателен (аудит платформенных действий):
# строки без hotel_id видны только платформенной роли.
_ENABLE_NULLABLE = """
ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE {table} FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON {table};
CREATE POLICY tenant_isolation ON {table}
    USING ({column}::text = current_setting('%s', true))
    WITH CHECK (
        {column} IS NULL
        OR {column}::text = current_setting('%s', true)
    );
""" % (SESSION_VAR, SESSION_VAR)

_DISABLE = """
DROP POLICY IF EXISTS tenant_isolation ON {table};
ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY;
ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;
"""


def enable_sql(tables: list[str], *, column: str = "hotel_id", nullable: bool = False) -> str:
    template = _ENABLE_NULLABLE if nullable else _ENABLE
    return "\n".join(template.format(table=table, column=column) for table in tables)


def disable_sql(tables: list[str]) -> str:
    return "\n".join(_DISABLE.format(table=table) for table in tables)
