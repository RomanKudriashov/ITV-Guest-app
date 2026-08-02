/**
 * Сторож правила «ни одного цвета вне словаря».
 *
 * Цвет разрешён только в файлах-словарях. Везде ещё — имя из словаря или слот
 * палитры темы. Правило существует не ради чистоты: пока цвет писали по месту,
 * светлая тема физически не могла дойти до витрины и админки — режим
 * переключался, а литералы оставались тёмными.
 *
 * Гоняется в `npm run build` (и отдельно `npm run lint:colors`), то есть на том
 * же рубеже, что сборка и типы: сторож, который надо не забыть запустить, — не
 * сторож.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

// Цвет в любом написании: #rgb/#rrggbb/#rrggbbaa, rgb()/rgba(), hsl()/hsla().
const COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(\s*\d|\bhsla?\(\s*\d/;

/**
 * Словари, где цвету и место. По одному на поверхность, у которой есть
 * собственный визуальный язык поверх темы отеля.
 */
const DICTIONARIES = new Set([
  'theme/tokens.ts',
  'guest/storefrontTokens.ts',
  'admin/adminTokens.ts',
]);

/**
 * Точечные исключения — каждое с причиной. Список короткий намеренно: он
 * должен резать глаз, если начнёт расти.
 */
const ALLOWED = new Set([
  // Редактор бренда — то самое место, где оператор ЗАДАЁТ цвет. Значение по
  // умолчанию для пустого поля градиента не является цветом интерфейса.
  'cms/brand/BrandEditor.tsx',
  // Живое превью бренда рисует монограмму инлайновым SVG: белый с
  // прозрачностью здесь часть картинки, а не цвет интерфейса.
  'cms/brand/previewData.ts',
  // Государственные флаги в переключателе языка. Цвета флага принадлежат
  // флагу, а не теме: перекрасить их «под бренд» — сделать флаг неверным.
  'kit/FlagIcon.tsx',
]);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(full)) yield full;
  }
}

const offenders = [];
for (const file of walk(SRC)) {
  const rel = relative(SRC, file).split('\\').join('/');
  if (DICTIONARIES.has(rel) || ALLOWED.has(rel)) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    // Комментарии не считаем: там цвет упоминают, а не применяют.
    const code = line.split('//')[0];
    if (COLOR.test(code)) offenders.push(`${rel}:${index + 1}  ${line.trim()}`);
  });
}

// Словарь мог переехать или исчезнуть — тогда сторож обязан упасть, а не
// молча пропустить всё дерево.
const missing = [...DICTIONARIES].filter((rel) => {
  try {
    statSync(join(SRC, rel));
    return false;
  } catch {
    return true;
  }
});

if (missing.length) {
  console.error(`Словарь пропал: ${missing.join(', ')}`);
  process.exit(1);
}

if (offenders.length) {
  console.error(`Цвет вне словаря (${offenders.length}):`);
  for (const line of offenders) console.error(`  ${line}`);
  process.exit(1);
}

console.log(`цвет только в словарях (${DICTIONARIES.size}), исключений ${ALLOWED.size}`);
