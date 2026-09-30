"""
SVG-ЛОГОТИП: ПРИНИМАЕМ, НО ТОЛЬКО РИСУНОК (партия 25).

Брендбук отдаёт логотип в SVG — это его родной формат, и переводить его в
растр значит терять резкость на любом экране, кроме того, под который резали.
Но SVG — это документ, а не картинка: в нём живут `<script>`, обработчики
`onload`, ссылки на чужие адреса, `<foreignObject>` с HTML. В `<img>` браузер
их не исполняет, а открытый по прямому адресу файл — исполняет, на домене
медиа.

Поэтому чистим ПО СПИСКУ РАЗРЕШЁННОГО, а не по списку запрещённого: чего нет в
списке элементов — вырезается вместе с содержимым; атрибут `on*` — снимается;
ссылка — только внутренняя (`#id`) или встроенная растровая картинка;
стили — без внешних `url(...)` и `@import`.

`<!DOCTYPE>` и `<!ENTITY>` не разбираем вовсе — отказ. Это закрывает и внешние
сущности, и «миллиард смешков» (раздувание внутренними сущностями), не требуя
отдельной библиотеки: логотипу DOCTYPE не нужен.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET

from apps.core.errors import ValidationError

SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"

ET.register_namespace("", SVG_NS)
ET.register_namespace("xlink", XLINK_NS)

# Рисунок, градиенты, маски, текст — всё, из чего состоит логотип. Ни
# `script`, ни `foreignObject`, ни `iframe`/`use` на внешний файл сюда не входят.
ALLOWED_ELEMENTS = {
    "svg", "g", "a", "defs", "title", "desc", "symbol", "use",
    "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
    "text", "tspan", "textPath",
    "linearGradient", "radialGradient", "stop",
    "clipPath", "mask", "pattern", "image", "style",
    "filter", "feGaussianBlur", "feOffset", "feBlend", "feColorMatrix",
    "feComposite", "feFlood", "feMerge", "feMergeNode", "feMorphology",
    "feDropShadow",
}

_SAFE_IMAGE_DATA = re.compile(r"^data:image/(png|jpe?g|webp|gif);base64,", re.I)
_EXTERNAL_IN_CSS = re.compile(r"@import|url\(\s*['\"]?\s*(?!#)|expression\s*\(|javascript:", re.I)

MAX_SVG_BYTES = 512 * 1024


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _safe_href(value: str) -> bool:
    value = value.strip()
    return value.startswith("#") or bool(_SAFE_IMAGE_DATA.match(value))


def _clean(element: ET.Element) -> None:
    for child in list(element):
        if not isinstance(child.tag, str) or _local(child.tag) not in ALLOWED_ELEMENTS:
            element.remove(child)
            continue
        _clean(child)

    for name in list(element.attrib):
        local = _local(name)
        value = element.attrib[name]
        if local.lower().startswith("on"):
            del element.attrib[name]
        elif local == "href" and not _safe_href(value):
            del element.attrib[name]
        elif local == "style" and _EXTERNAL_IN_CSS.search(value):
            del element.attrib[name]
        elif "javascript:" in value.lower():
            del element.attrib[name]

    if _local(element.tag) == "style" and element.text and _EXTERNAL_IN_CSS.search(element.text):
        element.text = ""


def sanitize_svg(content: bytes) -> bytes:
    """Очищенный SVG или отказ 422 с причиной, понятной оператору."""
    if len(content) > MAX_SVG_BYTES:
        raise ValidationError(
            f"SVG больше {MAX_SVG_BYTES // 1024} КБ — для логотипа это слишком много",
            field="file",
            code="svg_too_large",
        )
    head = content[:4096].lower()
    if b"<!doctype" in head or b"<!entity" in content.lower():
        raise ValidationError(
            "SVG с DOCTYPE или сущностями не принимается — сохраните логотип без них",
            field="file",
            code="svg_doctype",
        )
    try:
        root = ET.fromstring(content)
    except ET.ParseError:
        raise ValidationError("Файл не читается как SVG", field="file", code="svg_invalid") from None
    if _local(root.tag) != "svg":
        raise ValidationError("Файл не читается как SVG", field="file", code="svg_invalid")

    _clean(root)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)
