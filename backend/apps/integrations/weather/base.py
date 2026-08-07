"""
Погода: контракт провайдера.

ИНТЕРФЕЙС ОДНОМЕТОДНЫЙ, и это не аскетизм. Витрине нужна ровно одна вещь —
текущая погода в точке, — а всё остальное (прогнозы, история, качество воздуха)
у разных провайдеров устроено по-разному, и обобщать это заранее значит писать
абстракцию под несуществующего потребителя.

ПРОВАЙДЕР СМЕНЯЕМ. Open-Meteo выбран потому, что не требует ключа и его сервер
можно поставить рядом с собой, но продукт коммерческий и в проде провайдер
может оказаться другим — платным или своим. Поэтому наружу торчит протокол, а
не имя сервиса.

КОДЫ СОСТОЯНИЯ — WMO (ww), тот самый стандарт, которым отвечает Open-Meteo.
Своего словаря состояний мы не заводим: у любого провайдера погоды есть либо
WMO, либо однозначное соответствие ему, а вот «ясно/облачно» строкой у каждого
своё — и не на всех наших языках.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol


@dataclass(frozen=True)
class CurrentWeather:
    """Наблюдение в точке: температура в Цельсиях и код состояния WMO."""

    temperature_c: float
    code: int
    is_day: bool
    observed_at: datetime

    def as_payload(self) -> dict:
        return {
            "temperature_c": round(self.temperature_c, 1),
            "code": self.code,
            "is_day": self.is_day,
            "observed_at": self.observed_at.isoformat(),
        }


class WeatherProvider(Protocol):
    """
    Текущая погода по координатам. `None` — провайдер не ответил или ответил
    непонятно; выдумывать за него нельзя, это тот же обман, что и старое
    значение под видом текущего.
    """

    def current(self, latitude: float, longitude: float) -> CurrentWeather | None: ...
