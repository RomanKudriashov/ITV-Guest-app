"""
Уборка файлов прежней нарезки (партия 58в): `card`, `full` и `old-…`.

После 58а варианты — ряд ширин из целого оригинала (`w400…w3840`, `thumb`);
`rerender_media` оставлял прежние файлы рядом, потому что на них смотрели
адреса-строки (логотип в токенах бренда) и устаревший `image_full`. Релиз
прошёл: `image_full` снят, `url("card")`/`url("full")` берут файл из ряда.

Что убирается: объекты `card`, `full`, `old-*` у ассета, у которого ЕСТЬ ряд
ширин. Ассет без ряда (не перенарезан) не трогается — его `card`/`full`
единственные варианты. Исходник (`object_key`) не трогается никогда: логотип
гостю отдаётся именно им.

ИМЕНА УДАЛЁННЫХ КЛЮЧЕЙ ОСТАЮТСЯ (`variants["retired"]`). Логотип хранится в
токенах бренда адресом — нынешних и в истории версий; выдача находит по адресу
варианта ассет и отдаёт его исходник (`_logo_as_uploaded`). Без имён старый
адрес перестал бы вести к ассету.

    python manage.py clean_old_variants --dry-run [--hotel crystal]
    python manage.py clean_old_variants [--hotel crystal]

На стенде — только по слову, при выкатке.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand

from apps.core.context import tenant_context
from apps.hotels.models import Hotel
from apps.media.models import MediaAsset
from apps.media.services import storage

RETIRED = "retired"


def old_names(variants: dict) -> list[str]:
    return [name for name in (variants or {}) if name in ("card", "full") or name.startswith("old-")]


def _mb(n: int) -> str:
    return f"{n / 1024 / 1024:.1f} МБ"


class Command(BaseCommand):
    help = "Убрать файлы прежней нарезки (card, full, old-*) у перенарезанных ассетов"

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Ничего не удалять, посчитать объём")
        parser.add_argument("--hotel", default="", help="Только этот отель (поддомен)")

    def handle(self, *args, **options):
        dry = options["dry_run"]
        hotels = Hotel.all_objects.all()
        if options["hotel"]:
            hotels = hotels.filter(subdomain=options["hotel"])

        total_assets = total_files = total_bytes = skipped_legacy = failed = 0
        for hotel in hotels:
            assets = files = size = 0
            with tenant_context(hotel):
                for asset in MediaAsset.objects.filter(status=MediaAsset.Status.READY).iterator():
                    variants = dict(asset.variants or {})
                    names = old_names(variants)
                    if not names:
                        continue
                    if not asset.width_variants():
                        skipped_legacy += 1
                        continue
                    keys = [variants[name] for name in names if variants.get(name)]
                    # Ключ, который заодно лежит в нынешнем ряду, не удаляем.
                    live = {key for name, key in variants.items() if name not in names and name != RETIRED}
                    keys = [key for key in keys if key not in live and key != asset.object_key]
                    size += sum(storage.object_size(key) for key in keys)
                    files += len(keys)
                    assets += 1
                    if dry:
                        continue
                    result = storage.delete_objects(keys)
                    failed += len(result["failed"])
                    retired = list(variants.get(RETIRED) or [])
                    retired += [key for key in result["deleted"] if key not in retired]
                    for name in names:
                        if variants.get(name) not in result["failed"]:
                            variants.pop(name, None)
                    variants[RETIRED] = retired
                    asset.variants = variants
                    asset.save(update_fields=["variants", "updated_at"])
            if assets:
                self.stdout.write(f"{hotel.subdomain}: ассетов {assets}, файлов {files}, {_mb(size)}")
            total_assets += assets
            total_files += files
            total_bytes += size

        verb = "к уборке" if dry else "убрано"
        self.stdout.write(
            f"{verb}: ассетов {total_assets}, файлов {total_files}, {_mb(total_bytes)}; "
            f"без ряда ширин (не тронуты): {skipped_legacy}; не удалось: {failed}"
        )
        if dry:
            self.stdout.write(self.style.WARNING("Пробный проход: ничего не удалено."))
