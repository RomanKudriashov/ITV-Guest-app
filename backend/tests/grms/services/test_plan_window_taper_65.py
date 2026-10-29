"""
ПЕРСПЕКТИВА ОКНА (партия 65): проём на кадре снят под углом и выглядит как
трапеция. Поле `taper` у окна доезжает до снимка целым, битое — отбрасывается,
и окно остаётся прямоугольным.
"""

from __future__ import annotations

import pytest

from apps.grms.services.plan import normalize

BASE = {
    "asset_id": "a1",
    "zones": [{"controlId": "light", "hit": {"x": 0, "y": 0, "w": 50, "h": 50}, "mask": {"x": 0, "y": 0, "w": 50, "h": 50}}],
}


def _window(taper):
    raw = {**BASE, "windows": [{"code": "w", "x": 20, "y": 10, "w": 4, "h": 70, "orientation": "vertical", "curtainId": "curtain", "taper": taper}]}
    return normalize(raw, control_ids={"light", "curtain"})["windows"][0]


def test_bite_taper_reaches_the_snapshot():
    assert _window({"side": "end", "start": 11.9, "end": 7.5})["taper"] == {"side": "end", "start": 11.9, "end": 7.5}


@pytest.mark.parametrize(
    "taper",
    [None, "end", {"side": "middle", "start": 5, "end": 5}, {"side": "end", "start": 60, "end": 5}, {"side": "start", "start": -1, "end": 5}, {"side": "end", "start": 0, "end": 0}, {"side": "end", "start": "x"}],
)
def test_broken_taper_leaves_a_plain_window(taper):
    assert "taper" not in _window(taper)


def test_luma_is_gamma_scaled_luminance_and_none_without_value():
    """Яркость кадра для экспозиции светлой темы (партия 65): 0…255 в гамма-шкале."""
    from types import SimpleNamespace

    from apps.grms.services.plan import _luma

    assert _luma(None) is None
    assert _luma(SimpleNamespace(luminance=None)) is None
    assert _luma(SimpleNamespace(luminance=0.0)) == 0
    assert _luma(SimpleNamespace(luminance=1.0)) == 255
    assert 90 <= _luma(SimpleNamespace(luminance=0.11)) <= 95, "средний светлый рендер ~92"
