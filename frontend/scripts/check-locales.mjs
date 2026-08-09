/**
 * Сторож полноты локалей.
 *
 * Что проверяется: КАЖДЫЙ ключ есть во ВСЕХ четырёх языках, и ни одно значение
 * не пустое. Дыру в переводе видно только на экране того языка, которым никто
 * из нас не пользуется каждый день, — до сих пор расхождения ловили разово,
 * скриптом, уже после того как они доезжали до витрины.
 *
 * ЧТО ДЫРОЙ НЕ СЧИТАЕТСЯ — множественные формы. У языков их разное число:
 * у русского три (1 файл / 2 файла / 5 файлов), у английского две, у китайского
 * одна, у арабского шесть. Требовать одинакового набора значило бы требовать от
 * китайского пять форм, которых в языке нет, — сторож стал бы красным навсегда
 * и его бы выключили. Поэтому ключи сравниваются ПО ОСНОВЕ: `items_one` и
 * `items_many` — это один ключ `items`.
 *
 *     node scripts/check-locales.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCALES = fileURLToPath(new URL('../src/i18n/locales', import.meta.url));

// Суффиксы множественных форм i18next. Основа ключа — то, что до суффикса.
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/** Плоский список ключей: `guest.menu.title` вместо вложенных объектов. */
function flatten(node, prefix = '') {
  const out = new Map();
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [nested, nestedValue] of flatten(value, path)) out.set(nested, nestedValue);
    } else {
      out.set(path, value);
    }
  }
  return out;
}

const base = (key) => key.replace(PLURAL_SUFFIX, '');

const files = readdirSync(LOCALES).filter((name) => name.endsWith('.json')).sort();
if (files.length < 2) {
  console.error(`Локалей меньше двух (${LOCALES}) — сторожу нечего сравнивать.`);
  process.exit(1);
}

const languages = new Map();
for (const file of files) {
  languages.set(file.replace('.json', ''), flatten(JSON.parse(readFileSync(join(LOCALES, file), 'utf8'))));
}

// --- 1. Полнота: основа ключа обязана быть во всех языках --------------------

const everyBase = new Set();
for (const keys of languages.values()) {
  for (const key of keys.keys()) everyBase.add(base(key));
}

const missing = [];
for (const [language, keys] of languages) {
  const known = new Set([...keys.keys()].map(base));
  for (const key of everyBase) {
    if (!known.has(key)) missing.push(`${language}: ${key}`);
  }
}

// --- 2. Пустые значения ------------------------------------------------------

const empty = [];
for (const [language, keys] of languages) {
  for (const [key, value] of keys) {
    if (typeof value === 'string' && value.trim() === '') empty.push(`${language}: ${key}`);
  }
}

if (missing.length || empty.length) {
  if (missing.length) {
    console.error(`Ключей нет в переводе (${missing.length}):`);
    for (const line of missing.slice(0, 40)) console.error(`  ${line}`);
    if (missing.length > 40) console.error(`  … и ещё ${missing.length - 40}`);
    console.error('');
  }
  if (empty.length) {
    console.error(`Пустые значения (${empty.length}):`);
    for (const line of empty.slice(0, 40)) console.error(`  ${line}`);
    console.error('');
  }
  console.error(
    'Ключ обязан быть во всех языках. Множественные формы дырой не считаются: ' +
      'ключи сравниваются по основе, без суффикса _one/_few/_many/_other.',
  );
  process.exit(1);
}

const counts = [...languages]
  .map(([language, keys]) => `${language} ${new Set([...keys.keys()].map(base)).size}`)
  .join(', ');
console.log(`Локали полны: ${languages.size} языка, основ ключей — ${counts}; пустых значений нет`);
