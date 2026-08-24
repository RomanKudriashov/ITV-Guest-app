/**
 * Сторож различимости иконок нижнего меню.
 *
 * «Главная» и «Номер» были ОДНИМ И ТЕМ ЖЕ домиком: средний путь `M6 10v9h12v-9`
 * совпадал дословно, крыша и дверь отличались парой координат. В ряду из шести
 * вкладок две одинаковые картинки — не мелочь оформления: гость целится в
 * «Номер» и попадает на «Главную», потому что различает вкладки по силуэту, а
 * не по подписи в восемь пикселей.
 *
 * Глазами такое не ловится: иконки лежат в разных концах файла, и похожими они
 * становятся не в момент рисования, а в момент правки соседней. Сторож
 * сравнивает ГЕОМЕТРИЮ.
 *
 *     node scripts/check-icons.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ICONS = fileURLToPath(new URL('../src/icons/icons.tsx', import.meta.url));
const NAV = fileURLToPath(new URL('../src/guest/layout/GuestLayout.tsx', import.meta.url));

const source = readFileSync(ICONS, 'utf8');

/** Тела всех иконок: имя → сырой JSX. */
const bodies = new Map();
for (const match of source.matchAll(
  /export const (Icon\w+) = createIcon\(\s*'[^']+',\s*([\s\S]*?)\n\);/g,
)) {
  bodies.set(match[1], match[2]);
}

/** Геометрия иконки: множество путей и окружностей, без пробелов. */
function geometry(name) {
  const body = bodies.get(name);
  if (!body) return null;
  const shapes = [
    ...[...body.matchAll(/d="([^"]+)"/g)].map((m) => `d:${m[1].replace(/\s+/g, '')}`),
    ...[...body.matchAll(/<circle([^/]*)\/>/g)].map(
      (m) => `c:${m[1].replace(/\s+/g, '').replace(/fill="currentColor"/, '')}`,
    ),
  ];
  return new Set(shapes);
}

// Какие иконки реально стоят в нижнем меню — читаем из самого меню, а не из
// списка в этом файле: список разошёлся бы с экраном на первой же правке.
const navSource = readFileSync(NAV, 'utf8');
const tabs = [...navSource.matchAll(/Icon:\s*(Icon\w+)/g)].map((m) => m[1]);
const unique = [...new Set(tabs)];

if (unique.length < 2) {
  console.error(`Во вкладках меню найдено ${unique.length} иконок — сторожу нечего сравнивать.`);
  process.exit(1);
}

const problems = [];
for (let i = 0; i < unique.length; i += 1) {
  const a = geometry(unique[i]);
  if (!a) {
    problems.push(`${unique[i]}: иконка вкладки не найдена в icons.tsx`);
    continue;
  }
  for (let j = i + 1; j < unique.length; j += 1) {
    const b = geometry(unique[j]);
    if (!b) continue;
    const shared = [...a].filter((shape) => b.has(shape));
    if (shared.length) {
      problems.push(
        `${unique[i]} и ${unique[j]} рисуют одно и то же: ${shared.join(', ')}`,
      );
    }
  }
}

if (problems.length) {
  console.error('Иконки нижнего меню неразличимы:');
  for (const line of problems) console.error(`  ${line}`);
  process.exit(1);
}

console.log(`Иконки меню различимы: ${unique.length} вкладок, общих фигур нет`);
