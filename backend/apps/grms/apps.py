from django.apps import AppConfig


class GrmsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.grms"
    label = "grms"
    verbose_name = "Управление номером (GRMS): типы номеров, переменные, элементы, публикация"
