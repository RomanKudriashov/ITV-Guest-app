from django.apps import AppConfig


class GrmsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.grms"
    label = "grms"
    verbose_name = "Управление номером (GRMS): типы номеров, переменные, элементы, публикация"

    def ready(self) -> None:
        # Секреты серверов управления шифруются ключом из окружения (63-3).
        # Без ключа — понятная ошибка запуска, а не падение на первой правке.
        from apps.grms import vault

        vault.check_key()
