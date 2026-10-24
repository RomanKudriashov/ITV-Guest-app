"""
КОННЕКТОР «СИАЛИИ» (партия 64-1): свои конфиги для dev и стенда.

Проверяется настоящий файл конфига, тот, что смонтирует служба
`connector-sialia`: разрешённый круг — только эмулятор `iridi-emulator:1085`,
адрес из Control вне круга коннектор не примет, ключ в конфиг не пишется.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from itv_connector.config import ConnectorConfig
from itv_connector.remote import OUTSIDE_ALLOWED, apply_settings

CONFIGS = [Path("/connector/config.sialia.dev.json"), Path("/connector/config.sialia.stand.json")]


@pytest.mark.parametrize("path", CONFIGS, ids=lambda p: p.name)
def test_sialia_connector_config(path, monkeypatch):
    raw = json.loads(path.read_text())
    # Путь к файлу ключа (`node_key_file`) — можно; сам ключ полем — нельзя.
    assert not {"key", "node_key", "nodeKey"} & set(raw), "ключ узла в конфиге"
    monkeypatch.setenv("ITV_CONNECTOR_KEY", "node-key-sialia-64-1")
    config = ConnectorConfig.load(path)
    assert [t.describe() for t in config.allowed_targets] == ["iridi-emulator:1085"]
    local = config.endpoints
    inside, _, ok = apply_settings({"revision": 1, "endpoints": {"iridi": {"baseUrl": "http://iridi-emulator:1085"}}}, local=local, circle=config.allowed_targets)
    assert ok["ok"] and inside["iridi"].base_url == "http://iridi-emulator:1085"
    _, _, refused = apply_settings({"revision": 2, "endpoints": {"iridi": {"baseUrl": "http://10.0.0.5:1085"}}}, local=local, circle=config.allowed_targets)
    assert not refused["ok"] and refused["reason"] == OUTSIDE_ALLOWED
