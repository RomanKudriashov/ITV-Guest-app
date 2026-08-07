"""Фоновое обновление погоды отеля."""

from __future__ import annotations

import logging

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(acks_late=True, max_retries=0, ignore_result=True)
def refresh_hotel_weather(hotel_id: str) -> None:
    """
    Один вызов провайдера и запись в кэш.

    БЕЗ РЕТРАЕВ. Не ответил — значит, в этот раз погоды нет; следующая попытка
    придёт по кулдауну через штатные минуты. Повторять сейчас значит долбить
    лежащий сервис ради украшения экрана.
    """
    from apps.hotels.models import Hotel
    from apps.integrations.weather import service

    hotel = Hotel.all_objects.filter(pk=hotel_id).first()
    if hotel is None:
        return
    point = service.coordinates_of(hotel)
    if point is None:
        return

    observation = service.get_provider().current(*point)
    if observation is None:
        logger.info("Погода: обновление отеля %s не удалось", hotel_id)
        return
    service.store(hotel.pk, observation)
