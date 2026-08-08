"""
Точка отметки он-прем узла (Local Connector).

Здесь у связи ОБРАТНОЕ направление: облако не ходит в отель, коробка ходит
наружу сама. Иначе и быть не может — узел стоит во внутренней сети объекта, за
NAT, и снаружи его просто нет.

Отдельный роутер, а не часть `/platform`: узел — не платформенный админ, у него
свой способ представиться (ключ), и пускать его под тем же классом
аутентификации значило бы расширить мастер-ключ платформы на железку в отеле.
"""

from __future__ import annotations

from django.http import HttpRequest
from ninja import Router, Schema

router = Router(tags=["onprem"])


class HeartbeatIn(Schema):
    key: str
    version: str = ""


@router.post("/heartbeat", auth=None, response={200: dict, 401: dict}, summary="Отметка узла")
def heartbeat(request: HttpRequest, payload: HeartbeatIn):
    from apps.hotels.services.onprem import touch

    node = touch(payload.key, version=payload.version)
    if node is None:
        # Один ответ и на «нет такого ключа», и на «ключ отозван»: разница между
        # ними — подсказка тому, кто ключи перебирает.
        return 401, {"detail": "Ключ не принят", "code": "node_key_rejected"}
    return 200, {
        "ok": True,
        "hotel": node.hotel.subdomain,
        "node": node.name,
        "purpose": node.purpose,
    }
