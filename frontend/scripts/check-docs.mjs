/**
 * Сторож книги: адреса экранов и переменные окружения.
 *
 * Вторая половина проверок документации; первая живёт в
 * `backend/tests/test_docs_guard.py` (перечисления модулей, ролей, тарифов и
 * команд). Разделение по ДОСТУПНОСТИ ФАЙЛОВ, а не по смыслу: контейнер бэкенда
 * видит только `/app` и `/docs`, а маршрутизатор фронта и `.env.example` лежат
 * вне их.
 *
 * ЧТО ЛОВИТ.
 *
 * 1. Адрес экрана, которого нет в маршрутизаторе. Мы только что переносили
 *    панель отеля из `/cms` в `/admin`; книга, оставшаяся на старом адресе,
 *    отправляла бы администратора в редирект, а после его снятия — в никуда.
 * 2. Переменную окружения, которой нет в образце. Названная только в книге,
 *    она означает настройку, которой не существует: человек её выставит и
 *    будет ждать эффекта.
 *
 *    Проверяются ТОЛЬКО имена внутри помеченного блока:
 *
 *        <!-- check:env -->
 *        | `APP_DOMAIN` | базовый домен |
 *        <!-- /check -->
 *
 *    Догадка по виду имени (заглавные с подчёркиванием) ловила коды ошибок
 *    (`CONNECTOR_OFFLINE`) и константы кода (`TENANT_TABLES`) — то есть
 *    краснела на прозе. Сторож, который спорит с текстом, а не с фактом,
 *    проживёт до первого раза, когда помешает.
 *
 * Маршруты читаются ИЗ САМОГО маршрутизатора, а список переменных — из
 * образцов окружения. Свой список внутри сторожа разошёлся бы с кодом ровно
 * так же, как книга, и сторож стал бы вторым источником неправды.
 *
 * ГДЕ ДЕЙСТВУЕТ. Только КНИГА: текущие документы `docs/*.md`, эксплуатация
 * `docs/ops/**` и три справочника. Архив — отчёты партий, аудиты, разборы —
 * сторожем не покрыт намеренно: это ДАТИРОВАННЫЕ документы, они описывают
 * состояние на день написания и обязаны его сохранять. Сторож на них требовал
 * бы переписывать историю при каждом переименовании, а это ровно тот сторож,
 * которого выключают.
 *
 *     node scripts/check-docs.mjs
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DOCS = join(ROOT, 'docs');
const ROUTER = join(ROOT, 'frontend/src/app/router.tsx');

/** Пути, которые адресом экрана не являются. */
const NOT_A_SCREEN = ['/api/', '/ws/', '/static/', '/landing/', '/.well-known/', '/etc/', '/var/', '/app/', '/usr/'];

/** Каталоги-архивы: датированные документы, которые обязаны остаться как есть. */
const ARCHIVE = new Set(['design', 'audit', 'refactor', 'grms']);

function* walk(dir, depth = 0) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    if (depth === 0 && ARCHIVE.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full, depth + 1);
    else if (full.endsWith('.md')) yield full;
  }
}

/** Маршруты фронта: и корневые, и вложенные под обоими корнями CMS. */
function knownScreens() {
  const text = readFileSync(ROUTER, 'utf8');
  const declared = [...text.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]);
  const children = declared.filter((path) => !path.startsWith('/'));
  const result = new Set(declared.filter((path) => path.startsWith('/')));
  // Дети корневой ветки — тоже адреса: `r/:roomNumber` это `/r/:roomNumber`.
  for (const child of children) result.add(`/${child}`);
  // Ветка CMS монтируется в корень, зависящий от хоста: `/admin` на адресе
  // отеля, `/cms` в режиме одного хоста. В книге законны оба.
  for (const root of ['/admin', '/cms']) {
    result.add(root);
    for (const child of children) result.add(`${root}/${child}`);
  }
  return new Set([...result].map(normalize));
}

/** `/admin/services/7` → `/admin/services/:id`: сравниваем формы, а не данные. */
function normalize(path) {
  return (
    path
      .replace(/\/+$/, '')
      .split('/')
      .map((part) => (/^([0-9a-f-]{6,}|\d+)$/i.test(part) ? ':id' : part))
      .join('/') || '/'
  );
}

function knownEnv() {
  const names = new Set();
  for (const file of ['.env.example', '.env.prod.example']) {
    const path = join(ROOT, file);
    if (!existsSync(path)) continue;
    for (const match of readFileSync(path, 'utf8').matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)) {
      names.add(match[1]);
    }
  }
  return names;
}

const screens = knownScreens();
/** Первые сегменты известных маршрутов: по ним отличаем адрес экрана от прочего. */
const roots = new Set([...screens].map((path) => `/${path.split('/')[1] ?? ''}`));
const env = knownEnv();
if (!screens.size) {
  console.error('маршруты не прочитались — сторож смотрит не туда');
  process.exit(1);
}
if (!env.size) {
  console.error('образец окружения не прочитался — сторож смотрит не туда');
  process.exit(1);
}

const problems = [];
let screenClaims = 0;
let envClaims = 0;

for (const file of walk(DOCS)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const short = file.slice(ROOT.length);
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/`(\/[a-z0-9/:_-]*)`/gi)) {
      const claim = match[1];
      if (claim === '/' || NOT_A_SCREEN.some((prefix) => claim.startsWith(prefix))) continue;
      screenClaims += 1;
      const candidate = normalize(claim);
      /*
        СУДИМ ТОЛЬКО О СВОИХ КОРНЯХ. Первый сегмент, которого нет ни у одного
        маршрута, означает, что это вообще не адрес экрана: кусок пути API,
        путь в файловой системе, фрагмент чужого URL. Гадать про них — значит
        краснеть на прозе.

        Что сторож ловит при таком сужении: переезд и переименование экрана
        под известным корнем — ровно случай `/cms` → `/admin`. Чего не ловит:
        исчезновение корня целиком; это названо здесь, а не умолчано.
      */
      const first = `/${candidate.split('/')[1] ?? ''}`;
      if (!roots.has(first)) continue;

      const known = [...screens].some(
        (path) =>
          candidate === path ||
          // Книга назвала вложенный экран под известным корнем…
          candidate.startsWith(`${path}/`) ||
          // …или, наоборот, корень раздела, у которого есть экраны.
          path.startsWith(`${candidate}/`),
      );
      if (!known) problems.push(`  ${short}:${index + 1} — экрана нет: ${claim}`);
    }

  });

  // Переменные окружения — только из помеченных блоков.
  const text = readFileSync(file, 'utf8');
  for (const [, kind, body] of text.matchAll(/<!--\s*check:([a-z-]+)\s*-->([\s\S]*?)<!--\s*\/check\s*-->/g)) {
    if (kind !== 'env') continue;
    for (const [, name] of body.matchAll(/`([A-Z][A-Z0-9_]+)`/g)) {
      envClaims += 1;
      if (!env.has(name)) {
        problems.push(`  ${short} — переменной нет в образце: ${name}`);
      }
    }
  }
}

if (problems.length) {
  console.error('Книга разошлась с кодом:');
  console.error(problems.join('\n'));
  console.error('\nЛибо поправьте книгу, либо верните то, что она описывает.');
  process.exit(1);
}

console.log(
  `Книга сверена: экранов названо ${screenClaims}, переменных заявлено ${envClaims}`,
);
