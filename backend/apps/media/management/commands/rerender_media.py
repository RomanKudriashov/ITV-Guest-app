"""
Перенарезать медиатеку на ряд ширин (партия 58а).

До партии варианты были `thumb/card/full` (200/600/1200) и резались по рамке
`crop`; теперь — `thumb` и ряд `MEDIA_WIDTHS` из ЦЕЛОГО оригинала, плюс средний
цвет. Команда переводит старые ассеты на новый вид.

Ряд и качество — из `MEDIA_WIDTHS`/`MEDIA_WEBP_QUALITY` (docs/decisions.md,
п.16). Ассет, нарезанный другим рядом или другим качеством (`variant_quality`),
перенарезается; так команда ловит и прежние 80/2400 партии 58а.

Идемпотентна: ассет, нарезанный нынешним рядом и качеством, пропускается
(`--force` — перенарезать всё). `--dry-run` ничего не пишет: режет в память и
считает объём — по всем или по выборке (`--sample N`, оценка с экстраполяцией).

Старые объекты (`card`/`full`) НЕ удаляются: на них ещё смотрят строки в
токенах бренда (логотип хранится адресом) и устаревшее `image_full`. Их уборка —
вместе с полем `crop`, через релиз. Объём старых команда называет.

На стенде — только по слову, при выкатке.

    python manage.py rerender_media --dry-run [--sample 40] [--hotel crystal]
    python manage.py rerender_media [--hotel crystal] [--force]
"""

from __future__ import annotations

import random

from django.core.management.base import BaseCommand

from apps.core.context import tenant_context
from apps.hotels.models import Hotel
from apps.media.models import MediaAsset
from apps.media.services import storage

SKIP_KINDS = {MediaAsset.Kind.FONT}


def _needs(asset: MediaAsset) -> bool:
    from apps.media.tasks import needs_rerender

    return needs_rerender(asset)


def _mb(n: int) -> str:
    return f"{n / 1024 / 1024:.1f} МБ"


class Command(BaseCommand):
    help = "Перенарезать медиатеку на ряд ширин (идемпотентно, с --dry-run)"

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Ничего не писать, посчитать объём")
        parser.add_argument("--sample", type=int, default=0, help="При --dry-run резать выборку N и экстраполировать")
        parser.add_argument("--hotel", default="", help="Только этот отель (поддомен)")
        parser.add_argument("--force", action="store_true", help="Перенарезать и уже переведённые")

    def handle(self, *args, **options):
        import uuid

        from apps.media.tasks import render_variant_bytes

        dry, sample, force = options["dry_run"], options["sample"], options["force"]
        hotels = Hotel.all_objects.all()
        if options["hotel"]:
            hotels = hotels.filter(subdomain=options["hotel"])

        todo: list[tuple[Hotel, MediaAsset]] = []
        skipped = 0
        old_bytes_assets = 0
        # ПО ОТЕЛЯМ: строки закрыты RLS, без контекста тенанта база отдаёт пустоту.
        for hotel in hotels:
            with tenant_context(hotel):
                for asset in MediaAsset.objects.filter(status=MediaAsset.Status.READY).iterator():
                    if asset.kind in SKIP_KINDS or asset.content_type == "image/svg+xml":
                        continue
                    if force or _needs(asset):
                        todo.append((hotel, asset))
                        if any(k in (asset.variants or {}) for k in ("card", "full")):
                            old_bytes_assets += 1
                    else:
                        skipped += 1

        chosen = todo
        if dry and sample and sample < len(todo):
            chosen = random.Random(58).sample(todo, sample)

        written = failed = 0
        new_bytes = 0
        for hotel, asset in chosen:
            with tenant_context(hotel):
                try:
                    raw = storage.get_bytes(asset.object_key)
                    bodies = render_variant_bytes(raw, asset)
                    new_bytes += sum(len(b) for b in bodies.values())
                    if not dry:
                        variants = {}
                        for name, body in bodies.items():
                            key = storage.object_key(
                                asset.hotel_id, asset.kind, f"{uuid.uuid4().hex}.webp", variant=name
                            )
                            storage.put_bytes(key, body, content_type="image/webp")
                            variants[name] = key
                        # Старые ключи остаются рядом — на них ещё смотрят
                        # адреса-строки (логотип в токенах): `card`/`full` как
                        # были, прежний ряд ширин — под `old-<имя>`, чтобы не
                        # путаться с нынешним. Объекты уходят вместе с ассетом.
                        legacy = {}
                        for name, value in (asset.variants or {}).items():
                            if name in ("card", "full") or name.startswith("old-"):
                                legacy[name] = value
                            elif value not in variants.values():
                                legacy[f"old-{name}"] = value
                        asset.variants = {**legacy, **variants}
                        asset.save(
                            update_fields=[
                                "variants",
                                "width",
                                "height",
                                "luminance",
                                "average_color",
                                "variant_quality",
                                "updated_at",
                            ]
                        )
                    written += 1
                except Exception as exc:  # noqa: BLE001 — битый кадр не повод падать
                    failed += 1
                    self.stderr.write(f"{hotel.subdomain} {asset.pk}: {exc}")

        scale = len(todo) / len(chosen) if chosen else 0
        estimate = round(new_bytes * scale)
        verb = "нарезано бы" if dry else "нарезано"
        self.stdout.write(
            f"к перенарезке: {len(todo)} (со старыми card/full: {old_bytes_assets}), уже на ряде ширин: {skipped}"
        )
        self.stdout.write(
            f"{verb}: {written}, не удалось: {failed}; объём новых вариантов: {_mb(new_bytes)}"
            + (f" (выборка {len(chosen)} из {len(todo)}, оценка на всё: {_mb(estimate)})" if scale > 1 else "")
        )
        if dry:
            self.stdout.write(self.style.WARNING("Пробный проход: ничего не записано."))
