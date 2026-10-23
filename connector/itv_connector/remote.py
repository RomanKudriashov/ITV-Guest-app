"""
Адрес сервера управления — из Control, но только в пределах РАЗРЕШЁННОГО КРУГА.

До 1.1 адрес знал только локальный файл, и это была граница доверия: облако
не может послать запрос во внутреннюю сеть отеля. Решение Олега (23.10): адрес
задаётся в Control, но коннектор принимает его, только если адрес попадает в
круг, заданный ПРИ УСТАНОВКЕ НА ОБЪЕКТЕ (`allowedTargets` локального конфига:
сети CIDR или имена хостов, и порты). Круг пуст — облачный адрес не
принимается вовсе, действует адрес из файла, как раньше.

Граница доверия при этом остаётся на объекте: облако выбирает ВНУТРИ круга, а
сам круг — дело того, кто ставил коннектор.

Секрет сервера (логин и пароль, токен) приходит из облака в заголовках и
живёт только в памяти коннектора: в файл, в лог и в ответ облаку не пишется.
"""

from __future__ import annotations

import ipaddress
import logging
from dataclasses import dataclass, field, replace
from urllib.parse import urlparse

from .executor import Endpoint

log = logging.getLogger("itv.connector")

# Причины отказа — коды для облака; слова к ним подбирает Control.
OUTSIDE_ALLOWED = "outside_allowed"
NO_ALLOWED_CIRCLE = "no_allowed_circle"
BAD_ADDRESS = "bad_address"
UNKNOWN_ENDPOINT = "unknown_endpoint"


@dataclass(frozen=True)
class Target:
    """Одно правило круга: сеть (CIDR) или имя хоста, и разрешённые порты."""

    net: ipaddress.IPv4Network | ipaddress.IPv6Network | None = None
    host: str = ""
    ports: tuple[int, ...] = ()

    @classmethod
    def from_config(cls, raw: dict) -> "Target":
        ports = tuple(int(p) for p in (raw.get("ports") or []))
        if raw.get("net"):
            return cls(net=ipaddress.ip_network(str(raw["net"]), strict=False), ports=ports)
        if raw.get("host"):
            return cls(host=str(raw["host"]).strip().lower(), ports=ports)
        raise ValueError("правило круга без net и без host")

    def matches(self, host: str, port: int) -> bool:
        if self.ports and port not in self.ports:
            return False
        if self.host:
            return host.lower() == self.host
        try:
            return ipaddress.ip_address(host) in self.net  # type: ignore[operator]
        except ValueError:
            # Имя хоста в сеть не попадает: сеть разрешает адреса, а не имена,
            # иначе имя, которое резолвится куда угодно, обходило бы круг.
            return False

    def describe(self) -> str:
        where = self.host or str(self.net)
        return f"{where}:{','.join(map(str, self.ports))}" if self.ports else where


@dataclass
class RemoteState:
    """Что сейчас действует: адреса из Control или из файла."""

    source: str = "local"  # local | control
    revision: int = 0
    reason: str = ""
    applied: dict[str, str] = field(default_factory=dict)


def allowed(circle: list[Target], host: str, port: int) -> bool:
    return any(target.matches(host, port) for target in circle)


def apply_settings(
    message: dict,
    *,
    local: dict[str, Endpoint],
    circle: list[Target],
) -> tuple[dict[str, Endpoint], RemoteState, dict]:
    """
    Сообщение облака → (действующие endpoint'ы, состояние, ответ облаку).

    Чистая функция: ничего не пишет и не логирует секретов. Пустые настройки
    (`endpoints: null`) — «в Control адрес не задан»: действует локальный файл.
    Отказ по любому endpoint'у — отказ целиком, действуют прежние адреса из
    файла: половина настроек хуже, чем никакие.
    """
    revision = int(message.get("revision") or 0)
    wanted = message.get("endpoints")
    if not wanted:
        state = RemoteState(source="local", revision=revision)
        return dict(local), state, _result(revision, True, "", state)

    if not circle:
        state = RemoteState(source="local", revision=revision, reason=NO_ALLOWED_CIRCLE)
        return dict(local), state, _result(revision, False, NO_ALLOWED_CIRCLE, state)

    effective = dict(local)
    applied: dict[str, str] = {}
    for name, cfg in wanted.items():
        base = local.get(name)
        if base is None:
            state = RemoteState(source="local", revision=revision, reason=UNKNOWN_ENDPOINT)
            return dict(local), state, _result(revision, False, UNKNOWN_ENDPOINT, state, endpoint=name)
        url = str((cfg or {}).get("baseUrl") or "").rstrip("/")
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            state = RemoteState(source="local", revision=revision, reason=BAD_ADDRESS)
            return dict(local), state, _result(revision, False, BAD_ADDRESS, state, endpoint=name)
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        if not allowed(circle, parsed.hostname, port):
            state = RemoteState(source="local", revision=revision, reason=OUTSIDE_ALLOWED)
            return dict(local), state, _result(revision, False, OUTSIDE_ALLOWED, state, endpoint=name, address=f"{parsed.hostname}:{port}")
        timeout = int((cfg or {}).get("timeoutMs") or base.timeout_ms)
        effective[name] = replace(
            base,
            base_url=url,
            # Не дольше, чем разрешил объект: таймаут из облака только сужает.
            timeout_ms=max(200, min(timeout, 30000)),
            headers=dict((cfg or {}).get("headers") or {}),
        )
        applied[name] = f"{parsed.hostname}:{port}"
    state = RemoteState(source="control", revision=revision, applied=applied)
    return effective, state, _result(revision, True, "", state)


def _result(revision: int, ok: bool, reason: str, state: RemoteState, **extra) -> dict:
    # Ответ облаку — без заголовков и без секретов: только что принято и откуда.
    return {
        "type": "connector.settings.result",
        "revision": revision,
        "ok": ok,
        "reason": reason,
        "source": state.source,
        "applied": dict(state.applied),
        **extra,
    }
