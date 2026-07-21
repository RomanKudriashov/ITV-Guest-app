from django.apps import AppConfig


class HotelsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.hotels"
    label = "hotels"
    verbose_name = "Отели: тенант, бренд, номера, точки исполнения, локации, расписания"
