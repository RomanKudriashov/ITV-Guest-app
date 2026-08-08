"""
Генерация QR для номеров.

QR кодирует рабочий deep-link `/r/<номер>` на публичном адресе отеля — ровно
тот, что понимает гостевой вход. Скан открывает витрину, привязанную к номеру,
без единого лишнего экрана.
"""

from __future__ import annotations

import io

import qrcode
import qrcode.image.svg


def qr_svg(data: str) -> bytes:
    """QR как SVG (векторный — печатается на любом размере без потери качества)."""
    factory = qrcode.image.svg.SvgPathImage
    img = qrcode.make(data, image_factory=factory, box_size=10, border=2)
    buffer = io.BytesIO()
    img.save(buffer)
    return buffer.getvalue()


def qr_png(data: str, *, box_size: int = 10) -> bytes:
    qr = qrcode.QRCode(box_size=box_size, border=2, error_correction=qrcode.constants.ERROR_CORRECT_M)
    qr.add_data(data)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return buffer.getvalue()


def _svg_inner(data: str) -> str:
    """SVG без внешнего <?xml?> — для вставки внутрь HTML-листа."""
    raw = qr_svg(data).decode("utf-8")
    start = raw.find("<svg")
    return raw[start:] if start != -1 else raw


def qr_sheet_html(hotel_name: str, rooms: list[tuple[str, str]]) -> str:
    """
    Печатный лист всех QR: самодостаточная HTML-страница, готовая к печати из
    браузера. Инлайн-SVG, стили печати — ничего не подгружается извне.

    rooms — список (номер, deep-link URL).
    """
    cards = "\n".join(
        f'''<div class="card">
              <div class="qr">{_svg_inner(url)}</div>
              <div class="num">{_escape(number)}</div>
              <div class="hint">Наведите камеру телефона</div>
            </div>'''
        for number, url in rooms
    )
    return f"""<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<title>QR-коды · {_escape(hotel_name)}</title>
<style>
  * {{ box-sizing: border-box; }}
  body {{ font-family: system-ui, sans-serif; margin: 24px; color: #111; }}
  h1 {{ font-size: 18px; margin: 0 0 16px; }}
  .grid {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }}
  .card {{ border: 1px solid #ddd; border-radius: 12px; padding: 16px;
           text-align: center; page-break-inside: avoid; }}
  .qr svg {{ width: 160px; height: 160px; }}
  .num {{ font-size: 22px; font-weight: 700; margin-top: 8px; }}
  .hint {{ font-size: 11px; color: #777; margin-top: 4px; }}
  @media print {{ body {{ margin: 0; }} .card {{ border-color: #ccc; }} }}
</style></head>
<body>
  <h1>QR-коды номеров · {_escape(hotel_name)}</h1>
  <div class="grid">{cards}</div>
</body></html>"""


def _escape(value: str) -> str:
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )
