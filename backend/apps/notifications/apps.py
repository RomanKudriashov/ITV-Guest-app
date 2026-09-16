from django.apps import AppConfig


class NotificationsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.notifications"
    label = "notifications"
    verbose_name = "Уведомления: каналы, эскалация, журнал"

    def ready(self) -> None:
        """
        Ступень эскалации — вид задания службы расписания. Регистрирует его
        владелец работы, а не планировщик (см. `apps/hotels/apps.py`).
        """
        from apps.core.services import scheduler
        from apps.notifications.services import delivery

        scheduler.register(delivery.STEP_JOB_KIND, delivery.run_step_job)
