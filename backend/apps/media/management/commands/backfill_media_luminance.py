"""
Досчитать яркость кадров, загруженных до появления поля.

Витрина подбирает плотность затемнения под стеклом по яркости кадра; у ассета
без неё она возьмёт безопасное умолчание — то есть затемнит сильнее, чем нужно.
Команда идемпотентна: уже посчитанные не трогает, если не сказать --all.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand

from apps.core.context import tenant_context
from apps.hotels.models import Hotel
from apps.media import storage
from apps.media.models import MediaAsset


class Command(BaseCommand):
    help = "Досчитать среднюю яркость кадров медиатеки"

    def add_arguments(self, parser):
        parser.add_argument("--all", action="store_true", help="Пересчитать даже посчитанные")

    def handle(self, *args, **options):
        import io

        from PIL import Image, ImageOps

        from apps.media.tasks import _mean_luminance

        done = failed = 0
        # ПО ОТЕЛЯМ, а не одним запросом: строки закрыты RLS, и без контекста
        # тенанта база честно отдаёт пустоту — команда «успешно» ничего бы не
        # сделала.
        for hotel in Hotel.all_objects.all():
            with tenant_context(hotel):
                queryset = MediaAsset.objects.filter(status=MediaAsset.Status.READY)
                if not options["all"]:
                    queryset = queryset.filter(luminance__isnull=True)
                for asset in queryset.iterator():
                    try:
                        raw = storage.get_bytes(asset.object_key)
                        with Image.open(io.BytesIO(raw)) as image:
                            image = ImageOps.exif_transpose(image).convert("RGB")
                            asset.luminance = _mean_luminance(image)
                        asset.save(update_fields=["luminance", "updated_at"])
                        done += 1
                    except Exception as exc:  # noqa: BLE001 — битый кадр не повод падать
                        failed += 1
                        self.stderr.write(f"{asset.pk}: {exc}")

        self.stdout.write(self.style.SUCCESS(f"Яркость посчитана: {done}, не удалось: {failed}"))
