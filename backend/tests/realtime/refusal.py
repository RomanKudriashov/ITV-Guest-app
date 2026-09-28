"""
Отказ сокета глазами БРАУЗЕРА, а не тестового коммуникатора.

`WebsocketCommunicator` показывает код закрытия и тогда, когда потребитель
закрыл сокет до `accept()`. Настоящий браузер в этом случае кода не видит:
рукопожатие отклонено (HTTP 403), `onclose` получает 1006. На этом разрыве
клиентская ветка «4401 — не переподключаться» годами была мёртвой, а тесты
зелёными. Помощник требует ту форму отказа, в которой код доходит до клиента:
соединение принято и закрыто с кодом.
"""

from __future__ import annotations


async def refused_with(communicator, timeout: float) -> int:
    connected, code = await communicator.connect(timeout=timeout)
    assert connected is True, (
        f"отказ до accept (код {code}): браузер увидит 403 и 1006, а не код отказа"
    )
    message = await communicator.receive_output(timeout=timeout)
    assert message["type"] == "websocket.close", message
    # Ни одного кадра данных до закрытия: отказ ничего не отдаёт.
    return message["code"]
