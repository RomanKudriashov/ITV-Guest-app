"""
Точка сборки фоновых задач интеграций.

Celery ищет задачи в `<приложение>.tasks` и глубже не заглядывает: задача,
лежащая в `apps.integrations.weather.tasks`, воркеру не видна, и он честно
отвечает «unregistered task». Поэтому задачи подпакетов ИМПОРТИРУЮТСЯ здесь —
имя у них остаётся своё, по месту жительства.
"""

from apps.integrations.weather.tasks import refresh_hotel_weather  # noqa: F401
