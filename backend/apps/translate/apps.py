from django.apps import AppConfig


class TranslateConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.translate"
    label = "translate"
    verbose_name = "Автоперевод содержимого"
