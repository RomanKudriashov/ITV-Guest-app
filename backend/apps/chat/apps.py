from django.apps import AppConfig


class ChatConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.chat"
    label = "chat"
    verbose_name = "Чат гость↔персонал"

    def ready(self) -> None:
        # Вид задания регистрирует ВЛАДЕЛЕЦ работы: планировщик о чате не знает.
        from apps.core.services import scheduler

        from apps.chat.services import unanswered

        scheduler.register(unanswered.JOB_KIND, unanswered.run)
