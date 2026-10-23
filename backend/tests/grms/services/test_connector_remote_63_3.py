"""
КОННЕКТОР 1.1: адрес сервера управления из Control — в пределах разрешённого
круга (партия 63-3). Проверяется НАСТОЯЩИЙ код `connector/itv_connector`.

Укусы:
* адрес вне круга — отказ с причиной, действуют адреса из локального файла;
* без настроек из Control (`endpoints: null`) — локальный файл, старое поведение;
* пустой круг — облачный адрес не принимается вовсе;
* секрет не попадает ни в ответ облаку, ни в лог коннектора, но доезжает до
  сервера управления заголовком.
"""

from __future__ import annotations

import asyncio
import json
import logging

import pytest

from itv_connector import __version__
from itv_connector.client import Connector
from itv_connector.config import ConnectorConfig
from itv_connector.executor import Endpoint, execute
from itv_connector.remote import NO_ALLOWED_CIRCLE, OUTSIDE_ALLOWED, Target, apply_settings

LOCAL = {"iridi": Endpoint(base_url="http://10.10.20.15:1085")}
CIRCLE = [Target.from_config({"net": "10.10.20.0/24", "ports": [1085]}), Target.from_config({"host": "iridi-emulator", "ports": [1085]})]


def _msg(url: str, headers: dict | None = None, revision: int = 3) -> dict:
    return {"type": "connector.settings", "revision": revision, "endpoints": {"iridi": {"baseUrl": url, "timeoutMs": 2500, "headers": headers or {}}}}


def test_inside_circle_accepted():
    effective, state, result = apply_settings(_msg("http://10.10.20.40:1085"), local=LOCAL, circle=CIRCLE)
    assert effective["iridi"].base_url == "http://10.10.20.40:1085" and effective["iridi"].timeout_ms == 2500
    assert state.source == "control" and result["ok"] is True and result["applied"] == {"iridi": "10.10.20.40:1085"}
    by_host, _, ok = apply_settings(_msg("http://iridi-emulator:1085"), local=LOCAL, circle=CIRCLE)
    assert ok["ok"] and by_host["iridi"].base_url == "http://iridi-emulator:1085"


@pytest.mark.parametrize(
    "url",
    [
        "http://10.10.21.5:1085",  # другая сеть
        "http://10.10.20.40:22",  # тот порт не разрешён
        "http://evil.example:1085",  # имя, которого нет в круге
        "http://iridi-emulator:8080",  # разрешённое имя, чужой порт
    ],
)
def test_bite_outside_circle_refused_and_local_kept(url):
    effective, state, result = apply_settings(_msg(url), local=LOCAL, circle=CIRCLE)
    assert result["ok"] is False and result["reason"] == OUTSIDE_ALLOWED
    assert effective["iridi"].base_url == "http://10.10.20.15:1085", "при отказе действует адрес из файла"
    assert state.source == "local"


def test_bite_no_settings_means_local_file():
    effective, state, result = apply_settings({"type": "connector.settings", "revision": 0, "endpoints": None}, local=LOCAL, circle=CIRCLE)
    assert effective == LOCAL and state.source == "local" and result["ok"] is True


def test_empty_circle_refuses_cloud_address():
    effective, state, result = apply_settings(_msg("http://10.10.20.40:1085"), local=LOCAL, circle=[])
    assert result["reason"] == NO_ALLOWED_CIRCLE and effective == LOCAL


def test_hostname_never_matches_a_net():
    # Сеть разрешает адреса, а не имена: имя резолвится куда угодно.
    only_net = [Target.from_config({"net": "10.0.0.0/8"})]
    _, _, result = apply_settings(_msg("http://iridi.local:1085"), local=LOCAL, circle=only_net)
    assert result["reason"] == OUTSIDE_ALLOWED


def test_bite_secret_reaches_server_but_not_cloud_or_log(caplog, monkeypatch):
    secret = "Bearer s3cret-token-63-3"
    effective, _, result = apply_settings(_msg("http://10.10.20.40:1085", {"Authorization": secret}), local=LOCAL, circle=CIRCLE)
    assert secret not in json.dumps(result), "секрет в ответе облаку"
    assert secret not in repr(effective["iridi"]), "секрет в отладочном выводе"

    # Заголовок доезжает до сервера управления — и именно последним.
    sent = {}

    class Opener:
        def open(self, request, timeout):
            sent.update(dict(request.header_items()))
            raise OSError("стоп")

    monkeypatch.setattr("urllib.request.build_opener", lambda *a: Opener())
    execute({"requestID": "r1", "endpoint": "iridi", "method": "POST", "path": "/", "body": {}, "headers": {"Authorization": "подмена"}}, effective)
    assert sent.get("Authorization") == secret

    # Лог коннектора при приёме настроек — без секрета.
    class Socket:
        def __init__(self):
            self.sent = []

        async def send(self, text):
            self.sent.append(text)

    config = ConnectorConfig(backend_url="ws://x", node_key="k", endpoints=dict(LOCAL), allowed_targets=CIRCLE)
    connector = Connector(config)
    socket = Socket()
    caplog.set_level(logging.DEBUG, logger="itv.connector")
    asyncio.run(connector._dispatch(socket, json.dumps(_msg("http://10.10.20.40:1085", {"Authorization": secret}))))
    assert secret not in caplog.text, "секрет в логе коннектора"
    assert secret not in "".join(socket.sent), "секрет в ответе облаку"
    assert json.loads(socket.sent[0])["ok"] is True
    assert connector.remote.source == "control"


def test_config_reads_circle_and_reports_code_version(tmp_path, monkeypatch):
    path = tmp_path / "config.json"
    path.write_text(json.dumps({
        "backend_url": "ws://x", "version": "0.0.1",
        "allowedTargets": [{"net": "10.10.20.0/24", "ports": [1085]}, {"host": "iridi-emulator"}],
        "endpoints": {"iridi": {"baseUrl": "http://10.10.20.15:1085"}},
    }))
    monkeypatch.setenv("ITV_CONNECTOR_KEY", "node-key-63-3-zzz")
    config = ConnectorConfig.load(path)
    assert config.version == __version__ == "1.1.0"
    assert [t.describe() for t in config.allowed_targets] == ["10.10.20.0/24:1085", "iridi-emulator"]
    assert "allowedTargets" in config.redacted() and "node-key-63-3-zzz" not in json.dumps(config.redacted())
