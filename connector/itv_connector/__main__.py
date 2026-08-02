"""
Точка входа коннектора.

Запускается как `python -m itv_connector /etc/itv-connector/config.json`.
Никаких аргументов, кроме пути к конфигу: всё остальное узел знает сам, а
чем меньше ручек на чужом сервере, тем меньше поводов туда возвращаться.
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys

from .client import Connector
from .config import ConnectorConfig


def main() -> int:
    logging.basicConfig(
        level=os.getenv("ITV_CONNECTOR_LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    log = logging.getLogger("itv.connector")

    path = sys.argv[1] if len(sys.argv) > 1 else os.getenv(
        "ITV_CONNECTOR_CONFIG", "/etc/itv-connector/config.json"
    )
    try:
        config = ConnectorConfig.load(path)
    except (OSError, ValueError) as exc:
        log.error("конфиг не загружен (%s): %s", path, exc)
        return 2

    # Ключ в лог не попадает никогда — ни в отладочном режиме.
    log.info("конфиг принят: %s", config.redacted())

    connector = Connector(config)
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, connector.stop)
        except NotImplementedError:  # не везде поддержано
            pass

    try:
        loop.run_until_complete(connector.run_forever())
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
