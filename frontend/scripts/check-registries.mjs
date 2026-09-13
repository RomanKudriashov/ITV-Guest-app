/**
 * Сторож близнецов: реестры фронта обязаны совпадать с серверными.
 *
 * У системы два реестра, написанных дважды — на питоне и на тайпскрипте:
 *
 *   поведение типа позиции  apps/catalog/offerings.py ↔ src/offerings/behaviour.ts
 *   слово каталога          apps/catalog/nouns.py     ↔ src/offerings/nouns.ts
 *
 * Второй экземпляр нужен по делу: витрина решает, спрашивать ли локацию, ещё до
 * того, как о заказе узнает сервер, а слово надо показать на экране, которому
 * заведение может быть неизвестно. Но два экземпляра одного правила — это
 * всегда обещание разойтись, и расходятся они молча: сервер считает позицию
 * бесплатной, экран требует цену, и узнаём мы об этом от отеля.
 *
 * Сторож читает ОБА файла как текст и сверяет их как данные. Питон здесь не
 * запускается: у сборки фронта его может не быть, а сверять надо всегда.
 *
 * ГОНЯЕТСЯ В `npm run build` — на том же рубеже, что типы и цвета. Сторож,
 * который надо не забыть запустить, — не сторож.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BACKEND = fileURLToPath(new URL('../../backend', import.meta.url));

const read = (path) => readFileSync(path, 'utf8');

/** Тело `{ … }` после названия — со счётом скобок, а не жадной точкой. */
function blockAfter(source, anchor) {
  const start = source.indexOf(anchor);
  if (start < 0) return null;
  const open = source.indexOf('{', start);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

/**
 * Плоская карта `ключ: значение`.
 *
 * Значение бывает записано строкой (`'dish'` на фронте) или КОНСТАНТОЙ
 * ПЕРЕЧИСЛЕНИЯ (`OfferingNoun.DISH` на сервере) — второе читается честнее в
 * коде, но сторожу его надо развернуть. Словарь констант передаётся вторым
 * доводом; без него константа осталась бы непонятым текстом и сторож сравнивал
 * бы «DISH» с «dish», вечно находя расхождение там, где его нет.
 */
function flatMap(block, constants = {}) {
  const out = {};
  const re = /^\s*["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*:\s*(?:["']([A-Za-z_][A-Za-z0-9_]*)["']|([A-Za-z_][A-Za-z0-9_.]*))/gm;
  let match;
  while ((match = re.exec(block))) {
    const raw = match[2] ?? match[3];
    out[match[1]] = raw in constants ? constants[raw] : raw;
  }
  return out;
}

/** `DISH = "dish", "Блюдо"` внутри TextChoices → `{ 'OfferingNoun.DISH': 'dish' }`. */
function pyChoices(source, className) {
  const out = {};
  const block = blockAfter(source, `class ${className}(models.TextChoices)`) ?? source;
  for (const match of source.matchAll(/^\s{4}([A-Z_]+)\s*=\s*"([a-z_]+)"/gm)) {
    out[`${className}.${match[1]}`] = match[2];
  }
  void block;
  return out;
}

const problems = [];

/* ── 1. Слово каталога ──────────────────────────────────────────────────── */

const nounsSource = read(`${BACKEND}/apps/catalog/nouns.py`);
const pyNouns = flatMap(
  blockAfter(nounsSource, 'SERVICE_TYPE_TO_NOUN'),
  pyChoices(nounsSource, 'OfferingNoun'),
);
const tsNouns = flatMap(
  blockAfter(read(`${ROOT}/src/offerings/nouns.ts`), 'SERVICE_TYPE_TO_NOUN'),
);

// Питон пишет значения через enum-константы (`OfferingNoun.DISH`), поэтому в
// карте они уже строками: `nouns.py` объявляет их значениями TextChoices.
for (const key of new Set([...Object.keys(pyNouns), ...Object.keys(tsNouns)])) {
  if (!(key in pyNouns)) problems.push(`слово: «${key}» есть на фронте, нет на сервере`);
  else if (!(key in tsNouns)) problems.push(`слово: «${key}» есть на сервере, нет на фронте`);
  else if (pyNouns[key] !== tsNouns[key]) {
    problems.push(`слово «${key}»: сервер говорит «${pyNouns[key]}», фронт — «${tsNouns[key]}»`);
  }
}

/* ── 2. Каждый тип заведения назван ─────────────────────────────────────── */

const serviceTypes = [
  ...read(`${BACKEND}/apps/hotels/models/service.py`).matchAll(
    /^\s{8}[A-Z_]+\s*=\s*"([a-z_]+)"/gm,
  ),
].map((m) => m[1]);

if (serviceTypes.length === 0) problems.push('типы заведений не прочитались — сторож ослеп');
for (const type of serviceTypes) {
  if (!(type in pyNouns)) problems.push(`тип заведения «${type}» без слова на сервере`);
  if (!(type in tsNouns)) problems.push(`тип заведения «${type}» без слова на фронте`);
}

/* ── 3. Поведение типа позиции ──────────────────────────────────────────── */

// Имена полей у близнецов разные по языковой привычке, и это нормально:
// сверяем по смыслу, а не по написанию.
const FIELDS = [
  ['creates_order', 'createsOrder'],
  ['allows_multiple_lines', 'allowsMultipleLines'],
  ['uses_modifiers', 'usesModifiers'],
  ['uses_fields', 'usesFields'],
  ['uses_content', 'usesContent'],
  ['uses_slots', 'usesSlots'],
];

const pySource = read(`${BACKEND}/apps/catalog/offerings.py`);
const tsSource = read(`${ROOT}/src/offerings/behaviour.ts`);

/** Питон: `OfferingType.PRODUCT: OfferingBehaviour(…)` → плоские поля. */
function pyBehaviours(source) {
  const block = blockAfter(source, 'BEHAVIOURS: dict[str, OfferingBehaviour]');
  const out = {};
  const re = /OfferingType\.([A-Z_]+):\s*OfferingBehaviour\(([\s\S]*?)\n {4}\)/g;
  let match;
  while ((match = re.exec(block))) {
    const body = match[2];
    const fields = {};
    for (const [py] of FIELDS) {
      const hit = new RegExp(`${py}\\s*=\\s*(True|False)`).exec(body);
      if (hit) fields[py] = hit[1] === 'True';
    }
    const order = /order_type\s*=\s*"([a-z]+)"/.exec(body);
    if (order) fields.order_type = order[1];
    out[match[1].toLowerCase()] = fields;
  }
  return out;
}

/** Тайпскрипт: `product: { … }` внутри `BEHAVIOURS`. */
function tsBehaviours(source) {
  const block = blockAfter(source, 'const BEHAVIOURS: Record<OfferingType, OfferingBehaviour>');
  const out = {};
  const re = /^ {2}([a-z_]+):\s*\{([\s\S]*?)^ {2}\},/gm;
  let match;
  while ((match = re.exec(block))) {
    const body = match[2];
    const fields = {};
    for (const [, ts] of FIELDS) {
      const hit = new RegExp(`${ts}:\\s*(true|false)`).exec(body);
      if (hit) fields[ts] = hit[1] === 'true';
    }
    const order = /orderType:\s*(?:'([a-z]+)'|null)/.exec(body);
    if (order) fields.orderType = order[1] ?? 'none';
    out[match[1]] = fields;
  }
  return out;
}

const py = pyBehaviours(pySource);
const ts = tsBehaviours(tsSource);

for (const type of new Set([...Object.keys(py), ...Object.keys(ts)])) {
  if (!py[type]) {
    problems.push(`поведение: тип «${type}» есть на фронте, нет на сервере`);
    continue;
  }
  if (!ts[type]) {
    problems.push(`поведение: тип «${type}» есть на сервере, нет на фронте`);
    continue;
  }
  for (const [pyField, tsField] of FIELDS) {
    const left = py[type][pyField];
    const right = ts[type][tsField];
    if (left === undefined || right === undefined) {
      problems.push(`поведение «${type}»: поле ${pyField}/${tsField} не прочиталось`);
    } else if (left !== right) {
      problems.push(`поведение «${type}».${pyField}: сервер ${left}, фронт ${right}`);
    }
  }
  if (py[type].order_type !== ts[type].orderType) {
    problems.push(
      `поведение «${type}».order_type: сервер «${py[type].order_type}», фронт «${ts[type].orderType}»`,
    );
  }
}

if (Object.keys(py).length === 0 || Object.keys(ts).length === 0) {
  problems.push('реестры поведений не прочитались — сторож ослеп');
}

/* ── Ответ ──────────────────────────────────────────────────────────────── */

if (problems.length) {
  console.error('Близнецы разошлись:\n' + problems.map((p) => `  • ${p}`).join('\n'));
  process.exit(1);
}

console.log(
  `Реестры сходятся: слов ${Object.keys(pyNouns).length} на ${serviceTypes.length} типов заведений, ` +
    `поведений ${Object.keys(py).length}`,
);
