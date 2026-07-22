"""
Экспорт срезов. Тяжёлое считается в Celery, не в запросе: `create_export`
кладёт задачу и сразу возвращает id, воркер зовёт `execute_export`.

Данные берём из тех же запросов, что и дашборд, — экспорт не заводит вторую
правду. XLSX пишем без зависимостей (xlsx — это zip из XML), чтобы стенд и
тесты не требовали лишних пакетов.
"""

from __future__ import annotations

import csv
import io
import zipfile
from xml.sax.saxutils import escape

from apps.core.context import tenant_context
from apps.hotels.models import Hotel

from . import queries
from .models import AnalyticsExport


# --- Набор данных ----------------------------------------------------------


def build_dataset(hotel: Hotel, user, kind: str, params: dict) -> tuple[list[str], list[list]]:
    if kind == "breakdown":
        data = queries.breakdown(hotel, user, params)
        headers = ["key", "label", "orders", "quantity", "revenue_minor", "share"]
        rows = [[r.get("key", ""), r.get("label", ""), r.get("orders", ""), r.get("quantity", ""),
                 r.get("revenue_minor", ""), r.get("share", "")] for r in data["rows"]]
        return headers, rows

    if kind == "drilldown":
        data = queries.drilldown(hotel, user, params)
        headers = ["number", "point", "status", "total_minor", "room", "rating", "created_at"]
        rows = [[o["number"], o["point"], o["status"], o["total_minor"], o["room"],
                 o["rating"], o["created_at"]] for o in data["orders"]]
        return headers, rows

    if kind == "operations":
        data = queries.operations(hotel, user, params)
        headers = ["point", "orders", "completed", "cancelled", "avg_reaction_seconds", "avg_fulfil_seconds"]
        rows = [[r.get("label", r["key"]), r["orders"], r["completed"], r["cancelled"],
                 r["avg_reaction_seconds"], r["avg_fulfil_seconds"]] for r in data["by_point"]]
        return headers, rows

    if kind == "traffic":
        data = queries.traffic(hotel, user, params)
        headers = ["entry_method", "sessions", "converted", "conversion"]
        rows = [[r["key"], r["sessions"], r["converted"], r["conversion"]] for r in data.get("by_entry", [])]
        return headers, rows

    if kind == "reviews":
        data = queries.reviews(hotel, user, params)
        headers = ["bucket", "reviews", "avg_rating", "low"]
        rows = [[r["bucket"], r["reviews"], r["avg_rating"], r["low"]] for r in data["trend"]]
        return headers, rows

    # summary — одна строка ключевых метрик.
    block = queries.summary(hotel, user, params)["current"]
    headers = list(block.keys())
    rows = [[block[h] for h in headers]]
    return headers, rows


# --- Рендер ----------------------------------------------------------------


def render_csv(headers: list[str], rows: list[list]) -> bytes:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(headers)
    for row in rows:
        writer.writerow(["" if c is None else c for c in row])
    return buffer.getvalue().encode("utf-8-sig")  # BOM — чтобы Excel не ломал кириллицу


def render_xlsx(headers: list[str], rows: list[list]) -> bytes:
    """Минимальный валидный xlsx без зависимостей (zip из XML, inline-строки)."""
    def cell(col: int, row: int, value) -> str:
        ref = f"{_col_letter(col)}{row}"
        if isinstance(value, bool):
            value = int(value)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return f'<c r="{ref}"><v>{value}</v></c>'
        text = escape("" if value is None else str(value))
        return f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{text}</t></is></c>'

    sheet_rows = [f'<row r="1">{"".join(cell(i + 1, 1, h) for i, h in enumerate(headers))}</row>']
    for r_idx, row in enumerate(rows, start=2):
        sheet_rows.append(f'<row r="{r_idx}">{"".join(cell(i + 1, r_idx, v) for i, v in enumerate(row))}</row>')
    sheet_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<sheetData>{"".join(sheet_rows)}</sheetData></worksheet>'
    )

    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '</Types>'
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        '</Relationships>'
    )
    workbook = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="Analytics" sheetId="1" r:id="rId1"/></sheets></workbook>'
    )
    workbook_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        '</Relationships>'
    )

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", root_rels)
        zf.writestr("xl/workbook.xml", workbook)
        zf.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        zf.writestr("xl/worksheets/sheet1.xml", sheet_xml)
    return buffer.getvalue()


def _col_letter(index: int) -> str:
    letters = ""
    while index > 0:
        index, rem = divmod(index - 1, 26)
        letters = chr(65 + rem) + letters
    return letters


# --- Жизненный цикл --------------------------------------------------------


def create_export(hotel_id, user, *, kind: str, export_format: str, params: dict) -> AnalyticsExport:
    with tenant_context(hotel_id):
        export = AnalyticsExport.objects.create(
            hotel_id=hotel_id,
            kind=kind,
            export_format="xlsx" if export_format == "xlsx" else "csv",
            params=params,
            requested_by=getattr(user, "pk", None),
            status=AnalyticsExport.Status.PENDING,
        )
    from .tasks import run_export_task

    export_id, hid = str(export.pk), str(hotel_id)
    # Считаем в воркере после коммита строки-задачи.
    from django.db import transaction

    transaction.on_commit(lambda: run_export_task.delay(export_id, hid))
    return export


def execute_export(export_id, hotel_id, *, user=None) -> AnalyticsExport:
    """Синхронное выполнение — зовётся и воркером, и тестами."""
    with tenant_context(hotel_id):
        export = AnalyticsExport.objects.filter(pk=export_id).first()
        if export is None:
            return None
        export.status = AnalyticsExport.Status.RUNNING
        export.save(update_fields=["status", "updated_at"])

        hotel = Hotel.objects.get(pk=hotel_id)
        actor = user or _actor(export.requested_by)
        try:
            headers, rows = build_dataset(hotel, actor, export.kind, export.params or {})
            if export.export_format == "xlsx":
                data = render_xlsx(headers, rows)
                ctype = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                ext = "xlsx"
            else:
                data = render_csv(headers, rows)
                ctype = "text/csv"
                ext = "csv"
            export.content = data
            export.content_type = ctype
            export.filename = f"analytics-{export.kind}-{export.params.get('preset', 'period')}.{ext}"
            export.row_count = len(rows)
            export.status = AnalyticsExport.Status.READY
            export.save(update_fields=["content", "content_type", "filename", "row_count", "status", "updated_at"])
        except Exception as exc:  # noqa: BLE001 — фиксируем ошибку, не роняем воркер
            export.status = AnalyticsExport.Status.FAILED
            export.error = str(exc)[:2000]
            export.save(update_fields=["status", "error", "updated_at"])
        return export


def _actor(user_id):
    """Реконструкция пользователя-инициатора для скоупа в воркере."""
    if not user_id:
        return _AllScopeActor()
    from apps.accounts.models import User

    user = User.all_objects.filter(pk=user_id).first()
    return user or _AllScopeActor()


class _AllScopeActor:
    """Фолбэк, если инициатор не найден: считаем как админ отеля (RLS всё равно держит отель)."""

    is_platform_admin = False
    is_hotel_admin = True
    pk = None
