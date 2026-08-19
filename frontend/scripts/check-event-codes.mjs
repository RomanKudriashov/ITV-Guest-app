/**
 * Сторож правила «человеку — человеческое».
 *
 * Коды событий (`platform.hotel.deleted`, `grms.read`, `order.status_changed`)
 * попадают в журнал платформы и в активность отеля, и оператор читает их
 * глазами. Незнакомый код экран показывает КАК ЕСТЬ — и это правильно:
 * инженеру он нужен, а подменять его словом «событие» значит лишить журнал
 * смысла. Но «показывается как есть» не должно означать «так и осталось»:
 * новый вид события обязан спотыкаться здесь, а не тихо доезжать до глаз.
 *
 * Список кодов берётся ИЗ БЭКЕНДА, а не поддерживается копией: копия
 * разъезжается молча, и ровно так двадцать кодов из сорока четырёх прожили
 * без перевода. Ищем строковые литералы вида `<домен>.<событие>` в вызовах
 * журнала — они там и объявляются.
 *
 * Гоняется в `npm run build` рядом с проверкой локалей: сторож, который надо
 * не забыть запустить, — не сторож.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND = fileURLToPath(new URL('../../backend/apps', import.meta.url));
const LOCALES = fileURLToPath(new URL('../src/i18n/locales', import.meta.url));
const LANGS = ['ru', 'en', 'ar', 'zh'];

// Домены, чьи события видит человек. Ограничение намеренное: не всякая точка
// с точкой в строке — событие журнала.
const DOMAINS = ['platform', 'grms', 'order', 'guest_session', 'impersonation'];
const CODE = new RegExp(`"((?:${DOMAINS.join('|')})\\.[a-z_.]+)"`, 'g');

/**
 * Коды, которые в журнал не пишутся, хотя выглядят как события: это ИМЕНА
 * ОБЪЕКТОВ (`object_type`), группы каналов и прочая внутренняя адресация.
 * Каждое исключение — с причиной, список должен резать глаз, если вырастет.
 */
const NOT_EVENTS = new Set([
  'grms.channel', // object_type записи журнала, не действие
  'grms.hotel',
  'grms.room_type',
  'grms.session',
  'order.event', // имя WS-сообщения
  'order.snapshot',
]);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === '__pycache__' || name === 'migrations') continue;
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (full.endsWith('.py')) yield full;
  }
}

const codes = new Set();
for (const file of walk(BACKEND)) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(CODE)) {
    if (!NOT_EVENTS.has(match[1])) codes.add(match[1]);
  }
}

function lookup(dict, code) {
  return code.split('.').reduce((node, part) => (node == null ? undefined : node[part]), dict);
}

const problems = [];
for (const lang of LANGS) {
  const dict = JSON.parse(readFileSync(join(LOCALES, `${lang}.json`), 'utf8'));
  const actions = dict?.admin?.action ?? {};
  for (const code of [...codes].sort()) {
    const value = lookup(actions, code);
    if (typeof value !== 'string' || !value.trim()) {
      problems.push(`${lang}: ${code}`);
    }
  }
}

if (!codes.size) {
  console.error('не найдено ни одного кода события — сторож смотрит не туда');
  process.exit(1);
}

if (problems.length) {
  console.error(`Коды событий без перевода (${problems.length}):`);
  for (const line of problems) console.error(`  ${line}`);
  console.error('\nДобавьте их в admin.action во всех четырёх локалях.');
  console.error('Если это не событие журнала — впишите его в NOT_EVENTS с причиной.');
  process.exit(1);
}

console.log(`коды событий переведены: ${codes.size} кодов × ${LANGS.length} языка`);
