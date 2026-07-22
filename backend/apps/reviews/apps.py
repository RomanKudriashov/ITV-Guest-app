from django.apps import AppConfig


class ReviewsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.reviews"
    label = "reviews"
    verbose_name = "Отзывы и оценки"

    def ready(self):
        from apps.events import subscribers  # noqa: F401
