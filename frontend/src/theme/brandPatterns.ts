/**
 * ПАТТЕРНЫ ФОНА — БЛИЗНЕЦ `backend/apps/hotels/brand_patterns.py`.
 *
 * ПОЧЕМУ РИСУЕМ НА КЛИЕНТЕ, А НЕ БЕРЁМ КАРТИНКУ С СЕРВЕРА. Сервер отдаёт
 * паттерн ОДНОГО, нейтрально-серого цвета — как заглушку для плиток выбора. На
 * витрине же паттерн обязан быть цвета темы: на тёмном фоне серые линии
 * пропадают, на светлом — грязнят. Цвет известен только клиенту, который знает
 * режим и палитру отеля, поэтому data-URI собирается здесь.
 *
 * ЧЕГО ЭТО СТОИТ И ЧЕМ ПОКРЫТО. Два экземпляра одного списка — то самое, за что
 * мы уже платили поведениями и словами. Поэтому коды сверяет сторож
 * (`scripts/check-registries.mjs`): разойтись молча они не могут — сборка
 * падает.
 */

/**
 * Тела паттернов — дословно те же, что на сервере.
 *
 * `%COLOR%` подставляется цветом темы. Прозрачности заданы внутри тел: это не
 * фон, а фактура, и она обязана оставаться подложкой, а не рисунком поверх.
 */
const PATTERN_BODIES: Record<string, string> = {
  linen:
    '<pattern id="p" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 0h8M0 4h8" stroke="%COLOR%" stroke-width="0.5" opacity="0.3"/></pattern>',
  waves:
    '<pattern id="p" width="40" height="20" patternUnits="userSpaceOnUse"><path d="M0 10 Q10 0 20 10 T40 10" fill="none" stroke="%COLOR%" stroke-width="1" opacity="0.25"/></pattern>',
  marble:
    '<pattern id="p" width="120" height="120" patternUnits="userSpaceOnUse"><path d="M0 30 Q40 10 80 40 T120 30 M0 80 Q50 60 90 90" fill="none" stroke="%COLOR%" stroke-width="1" opacity="0.2"/></pattern>',
  mesh: '<pattern id="p" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M0 0h24v24H0z" fill="none" stroke="%COLOR%" stroke-width="0.5" opacity="0.22"/></pattern>',
  dune: '<pattern id="p" width="60" height="30" patternUnits="userSpaceOnUse"><path d="M0 30 Q30 0 60 30" fill="none" stroke="%COLOR%" stroke-width="1.2" opacity="0.22"/></pattern>',
};

export const PATTERN_CODES = Object.keys(PATTERN_BODIES);

/**
 * Паттерн как `data:`-ссылка, окрашенный заданным цветом.
 *
 * Пустая строка — кода нет в списке: тема не выдумывает фактуру, которой не
 * знает, а честно рисует фон одним цветом.
 *
 * `encodeURIComponent`, а не base64: разница в объёме невелика, зато строка
 * читается глазами в инспекторе, и отличить «паттерн не тот» от «паттерна нет»
 * можно, не декодируя.
 */
export function patternDataUri(code: string, color: string): string {
  const body = PATTERN_BODIES[code];
  if (!body) return '';
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120">' +
    `<defs>${body.replace(/%COLOR%/g, color)}</defs>` +
    '<rect width="120" height="120" fill="url(#p)"/></svg>';
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
