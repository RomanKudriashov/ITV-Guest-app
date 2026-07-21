# SVG-паттерны абстракций как data-URI.
# Отдаём инлайном, а не файлом из /static: в браузере /static уходит на
# vite-dev-сервер, который его не раздаёт. data-URI работает везде —
# и в превью-фрейме, и в проде — и не требует раздачи статики.
# %COLOR% подставляется витриной под цвет темы (currentColor нельзя внутри
# background-image), поэтому здесь нейтральный серый как превью-заглушка.

def _data_uri(svg: str) -> str:
    import base64
    encoded = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    return f"data:image/svg+xml;base64,{encoded}"

_PATTERN_BODIES = {
    'linen': '<pattern id="p" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 0h8M0 4h8" stroke="%COLOR%" stroke-width="0.5" opacity="0.3"/></pattern>',
    'waves': '<pattern id="p" width="40" height="20" patternUnits="userSpaceOnUse"><path d="M0 10 Q10 0 20 10 T40 10" fill="none" stroke="%COLOR%" stroke-width="1" opacity="0.25"/></pattern>',
    'marble': '<pattern id="p" width="120" height="120" patternUnits="userSpaceOnUse"><path d="M0 30 Q40 10 80 40 T120 30 M0 80 Q50 60 90 90" fill="none" stroke="%COLOR%" stroke-width="1" opacity="0.2"/></pattern>',
    'mesh': '<pattern id="p" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M0 0h24v24H0z" fill="none" stroke="%COLOR%" stroke-width="0.5" opacity="0.22"/></pattern>',
    'dune': '<pattern id="p" width="60" height="30" patternUnits="userSpaceOnUse"><path d="M0 30 Q30 0 60 30" fill="none" stroke="%COLOR%" stroke-width="1.2" opacity="0.22"/></pattern>',
}

def abstraction_svg(code: str, color: str = "#889096") -> str:
    body = _PATTERN_BODIES.get(code)
    if body is None:
        return ""
    body = body.replace("%COLOR%", color)
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120">'
        f'<defs>{body}</defs><rect width="120" height="120" fill="url(#p)"/></svg>'
    )
    return _data_uri(svg)

