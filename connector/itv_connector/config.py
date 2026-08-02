"""
Локальный конфиг коннектора.

Живёт НА ОБЪЕКТЕ и backend его не читает и не правит. Это не удобство
развёртывания, а граница доверия: адреса внутренней сети, лимиты и список
разрешённых путей знает только тот, кто стоит внутри периметра.

Ключ узла читается из отдельного файла, а не из этого JSON: конфиг попадает в
резервные копии и логи развёртывания, ключ — не должен.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

from .executor import Endpoint


@dataclass
class ConnectorConfig:
    backend_url: str
    node_key: str
    endpoints: dict[str, Endpoint] = field(default_factory=dict)
    heartbeat_interval_s: int = 60
    max_concurrent_requests: int = 8
    version: str = "1.0.0"

    @classmethod
    def load(cls, path: str | Path) -> "ConnectorConfig":
        raw = json.loads(Path(path).read_text(encoding="utf-8"))

        endpoints = {
            name: Endpoint.from_config(cfg) for name, cfg in (raw.get("endpoints") or {}).items()
        }
        if not endpoints:
            raise ValueError("в конфиге нет ни одного endpoint — коннектору нечего исполнять")

        # Ключ: файл приоритетнее переменной окружения, окружение — dev-путь.
        key = ""
        key_file = raw.get("node_key_file")
        if key_file and Path(key_file).exists():
            key = Path(key_file).read_text(encoding="utf-8").strip()
        key = key or os.getenv("ITV_CONNECTOR_KEY", "").strip()
        if not key:
            raise ValueError("не найден ключ узла: ни node_key_file, ни ITV_CONNECTOR_KEY")

        backend_url = raw.get("backend_url") or os.getenv("ITV_BACKEND_URL", "")
        if not backend_url:
            raise ValueError("не задан backend_url")

        return cls(
            backend_url=backend_url,
            node_key=key,
            endpoints=endpoints,
            heartbeat_interval_s=int(raw.get("heartbeat_interval_s", 60)),
            # Скрипт iRidi поднимает сервер с max_http_clients = 50 на ВЕСЬ
            # объект. Восемь на узел оставляет запас другим потребителям.
            max_concurrent_requests=int(raw.get("max_concurrent_requests", 8)),
            version=str(raw.get("version", "1.0.0")),
        )

    def redacted(self) -> dict:
        """Вид для логов. Ключ не печатается никогда (ТЗ §16)."""
        return {
            "backend_url": self.backend_url,
            "endpoints": {
                name: {"baseUrl": ep.base_url, "allowedPaths": list(ep.allowed_paths)}
                for name, ep in self.endpoints.items()
            },
            "heartbeat_interval_s": self.heartbeat_interval_s,
            "max_concurrent_requests": self.max_concurrent_requests,
            "version": self.version,
        }
