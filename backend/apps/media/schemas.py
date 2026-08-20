"""
Схемы медиатеки.

Схемы объявлены ЗДЕСЬ, а не рядом со вьюхой: схема — это контракт домена, и
жить она должна там же, где модель и сервис, которые его исполняют. Пока
объявления лежали во вьюхах, один и тот же ресурс описывался в трёх местах, а
общее уезжало в общий `api/schemas.py`, куда сваливалось всё подряд.

Раскладка по ПОТРЕБИТЕЛЮ (guest / cms / platform / staff): у одного ресурса
разные права и разные поля наружу, и складывать их в один файл значит однажды
отдать гостю поле, которое собирали для оператора.
"""

from __future__ import annotations

from ninja import Schema



class MediaOut(Schema):
    id: str
    status: str
    url: str
    thumb_url: str
    original_filename: str
    # Исходник и рамка — для редактора кадра в CMS. Гостю не отдаются.
    original_url: str = ""
    crop: dict | None = None
    crop_ratio: float | None = None


class CropIn(Schema):
    """Рамка в долях ОРИГИНАЛА. `crop=None` — снять обрезку, вернуть целиком."""

    crop: dict | None = None
    ratio: float | None = None
