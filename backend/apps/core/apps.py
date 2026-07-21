from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.core"
    label = "core"
    verbose_name = "Ядро: базовые модели, мультитенантность, идемпотентность, аудит"

    def ready(self) -> None:
        # Подписчики событийной шины регистрируются самим фактом импорта.
        # Делаем это здесь, чтобы набор подписчиков был детерминированным и не
        # зависел от того, кто первым дёрнул шину.
        from apps.events import subscribers  # noqa: F401
