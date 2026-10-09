/**
 * Сторож видимого имени продукта (партия 50).
 *
 * Продукт называется NaviRoom. Прежние имена — «ITV Guest», «ITV Platform»,
 * «NaviApp» — жили в строках, которые видит человек: словари, заголовок
 * вкладки, манифест PWA (подпись значка на домашнем экране гостя). Вернуть
 * такое имя легко — скопировать соседнюю строку, — а заметить глазами трудно:
 * на русском экране его не видно, если правка была в арабском словаре.
 *
 * Поэтому сторож проверяет ДВА условия:
 *   1. ни одной видимой строки с прежним именем;
 *   2. `app.title` на всех языках — ровно «NaviRoom». Без второго прежние
 *      переводы («تطبيق نزلاء ITV», «ITV 客人应用») прошли бы мимо первого.
 *
 * ITV в прочих местах (ключи браузера, внутренние имена) не трогаем —
 * решение тек-лида, `docs/decisions.md`.
 *
 *     node scripts/check-brand-name.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LOCALES = `${ROOT}src/i18n/locales/`;
const NAME = 'NaviRoom';
const OLD = /ITV Guest|ITV Platform|NaviApp/i;

const problems = [];

function scan(label, text) {
  text.split('\n').forEach((line, index) => {
    if (OLD.test(line)) problems.push(`${label}:${index + 1}: ${line.trim()}`);
  });
}

/*
  ЗАГЛУШКИ КОНТАКТОВ (партия 51). На лендинге стояли `hello@itv.example` и
  `+7 900 000-00-00` — кнопки, ведущие в никуда. Пример ФОРМАТА в подсказке
  поля («например +7 900 000-00-00») — законен: ключи `…Hint` и `…placeholder`
  сторож пропускает, остальные строки — нет.
*/
const PLACEHOLDER_CONTACT = /000[\s-]?00[\s-]?00|@[\w.-]*\.example\b|\bitv\.example\b/i;
const EXAMPLE_KEY = /(hint|placeholder)$/i;

function scanContacts(label, node, path = '') {
  if (typeof node === 'string') {
    const key = path.split('.').pop() ?? '';
    if (PLACEHOLDER_CONTACT.test(node) && !EXAMPLE_KEY.test(key)) {
      problems.push(`${label}: ${path} = «${node}» — заглушка контакта на виду`);
    }
    return;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) scanContacts(label, value, path ? `${path}.${key}` : key);
  }
}

const languages = readdirSync(LOCALES).filter((file) => file.endsWith('.json'));
for (const file of languages) {
  const text = readFileSync(LOCALES + file, 'utf8');
  scan(`src/i18n/locales/${file}`, text);
  scanContacts(`src/i18n/locales/${file}`, JSON.parse(text));
  const title = JSON.parse(text).app?.title;
  if (title !== NAME) problems.push(`src/i18n/locales/${file}: app.title = «${title}», а не «${NAME}»`);
}
scan('index.html', readFileSync(`${ROOT}index.html`, 'utf8'));
const manifestText = readFileSync(`${ROOT}public/manifest.webmanifest`, 'utf8');
scan('public/manifest.webmanifest', manifestText);
const manifest = JSON.parse(manifestText);
for (const field of ['name', 'short_name']) {
  if (manifest[field] !== NAME) problems.push(`public/manifest.webmanifest: ${field} = «${manifest[field]}», а не «${NAME}»`);
}

// Манифест, который реально отдаётся, СОБИРАЕТСЯ в `vite.config.ts` (цвета —
// из токенов), а `public/manifest.webmanifest` — запасная копия. Первая версия
// сторожа смотрела только на копию и пропустила бы главное: e2e партии 50
// поймал «ITV Guest» в отдаваемом манифесте при чистой копии.
const viteConfig = readFileSync(`${ROOT}vite.config.ts`, 'utf8');
scan('vite.config.ts', viteConfig);
for (const field of ['name', 'short_name']) {
  if (!new RegExp(`\\b${field}: '${NAME}'`).test(viteConfig)) {
    problems.push(`vite.config.ts: в собираемом манифесте ${field} — не «${NAME}»`);
  }
}

if (problems.length) {
  console.error(`Видимое имя продукта — ${NAME}. Найдено прежнее:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`Имя продукта сверено: ${languages.length} словаря, index.html, манифест (копия и сборка) — везде ${NAME}; заглушек контактов нет`);
