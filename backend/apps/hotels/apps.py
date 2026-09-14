from django.apps import AppConfig


class HotelsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.hotels"
    label = "hotels"
    verbose_name = "Отели: тенант, бренд, номера, точки исполнения, локации, расписания"

    def ready(self) -> None:
        """
        Регистрируем обработчик отложенной публикации оформления.

        Планировщик не импортирует прикладной код: иначе он знал бы сразу обо
        всём — о бренде, переводах и уведомлениях. Знание идёт в обратную
        сторону: приложение-владелец работы объявляет свой вид задания само.
        """
        from apps.core.services import scheduler
        from apps.hotels.services import brand_schedule

        scheduler.register(brand_schedule.KIND, brand_schedule.run)
