"""
Карта тел запросов API для сторожа e2e (партия 31, DEV-01).

    python manage.py export_request_bodies > e2e/.cache/request-bodies.json

Для каждой пары «адрес + метод» с JSON-телом — какие поля схема знает и какие
обязательны. Сторож (`e2e/tests/fixtures.ts`) сверяет с этой картой каждое
тело, которое отправляет ФРОНТ, и роняет проверку на неизвестном поле или
пропущенном обязательном.

Зачем: django-ninja молча отбрасывает лишние поля. Трекер полгода слал
`{"reason": …}` вместо обязательного `cancel_reason` — сервер отвечал 422, а
проверки ответов этого не видели: ни одна не отменяла заказ из трекера.
"""

from __future__ import annotations

import json

from django.core.management.base import BaseCommand

METHODS = ("post", "put", "patch")


def _resolve(schema: dict, components: dict) -> dict:
    ref = schema.get("$ref")
    if ref:
        return _resolve(components[ref.rsplit("/", 1)[-1]], components)
    for key in ("allOf", "anyOf", "oneOf"):
        if key in schema:
            merged = {"properties": {}, "required": []}
            for part in schema[key]:
                part = _resolve(part, components)
                merged["properties"].update(part.get("properties", {}))
                if key == "allOf":
                    merged["required"] += part.get("required", [])
            return merged
    return schema


def body_map() -> dict:
    from api import api

    schema = api.get_openapi_schema()
    components = schema.get("components", {}).get("schemas", {})
    result: dict[str, dict] = {}
    for path, operations in schema["paths"].items():
        for method in METHODS:
            operation = operations.get(method)
            if not operation:
                continue
            content = (operation.get("requestBody") or {}).get("content", {})
            json_schema = content.get("application/json", {}).get("schema")
            entry: dict
            if json_schema is None:
                # Тело не JSON (файл) или тела нет вовсе: сверять нечего.
                entry = {"json": False}
            else:
                body = _resolve(json_schema, components)
                entry = {
                    "json": True,
                    "fields": sorted(body.get("properties", {})),
                    "required": sorted(body.get("required", [])),
                    # Тело-словарь без описанных полей (`dict`) — любые ключи законны.
                    "open": not body.get("properties") and body.get("type") == "object",
                }
            result[f"{method.upper()} {path}"] = entry
    return result


class Command(BaseCommand):
    help = "Выгрузить карту тел запросов API (для сторожа e2e)"

    def handle(self, *args, **options):
        self.stdout.write(json.dumps(body_map(), ensure_ascii=False, sort_keys=True))
