"""
Обновить снимок карты адресов — ОСОЗНАННО, руками.

Снимок сверяется тестом `test_url_map_matches_snapshot`. Автоматического
обновления у него нет намеренно: снимок, который чинит себя сам, — это не
снимок, а зеркало, и пропажу адреса он покажет ровно один раз, в тот же миг
затерев улику.

    python manage.py update_url_snapshot          # обновить
    python manage.py update_url_snapshot --check  # только показать расхождения
"""

from __future__ import annotations

import json
from pathlib import Path

from django.core.management.base import BaseCommand

SNAPSHOT = Path(__file__).resolve().parents[4] / "tests" / "snapshots" / "url_map.json"
METHODS = {"get", "post", "put", "patch", "delete"}


def current_routes() -> dict[str, list[str]]:
    from api import api

    schema = api.get_openapi_schema()
    return {
        path: sorted(method.upper() for method in operations if method in METHODS)
        for path, operations in schema["paths"].items()
    }


class Command(BaseCommand):
    help = "Обновить снимок карты адресов API (tests/snapshots/url_map.json)"

    def add_arguments(self, parser):
        parser.add_argument("--check", action="store_true", help="Только показать расхождения")

    def handle(self, *args, **options):
        routes = current_routes()
        previous = json.loads(SNAPSHOT.read_text()) if SNAPSHOT.exists() else {}

        added = sorted(set(routes) - set(previous))
        removed = sorted(set(previous) - set(routes))
        changed = sorted(p for p in routes if p in previous and routes[p] != previous[p])

        for path in added:
            self.stdout.write(self.style.SUCCESS(f"  + {path} {' '.join(routes[path])}"))
        for path in removed:
            self.stdout.write(self.style.ERROR(f"  − {path} {' '.join(previous[path])}"))
        for path in changed:
            self.stdout.write(
                self.style.WARNING(
                    f"  ~ {path}: было {' '.join(previous[path])}, стало {' '.join(routes[path])}"
                )
            )

        if options["check"]:
            self.stdout.write(f"Расхождений: {len(added) + len(removed) + len(changed)}")
            return

        SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
        SNAPSHOT.write_text(json.dumps(routes, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
        self.stdout.write(
            self.style.SUCCESS(f"Снимок обновлён: {len(routes)} адресов → {SNAPSHOT}")
        )
