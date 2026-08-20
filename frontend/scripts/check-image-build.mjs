/**
 * Сторож сборки прод-образа фронта.
 *
 * `infra/nginx/Dockerfile` копирует в build-стадию ТОЛЬКО `frontend/`. Значит
 * цель, которую он зовёт, не вправе требовать исходников бэкенда — а сторож
 * кодов событий читает `backend/apps`, и в полной цели `build` он честно падал
 * с ENOENT. Прод-образ перестал собираться ВООБЩЕ, и узнали мы об этом на
 * выкатке: локально `npm run build` бежит из корня репозитория, где бэкенд на
 * месте, и был зелёным.
 *
 * Проверка живёт ЗДЕСЬ, а не в тестах бэкенда: контейнер бэкенда монтирует
 * только `backend/`, и `infra/nginx/Dockerfile` для него не существует.
 *
 * Гоняется в `npm run build` — и намеренно НЕ в `build:image`: внутри образа
 * ни `infra/`, ни этой проверки быть не может, и притворяться иначе значило бы
 * заводить сторожа, который молчит ровно там, где его нельзя проверить.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DOCKERFILE = join(ROOT, 'infra', 'nginx', 'Dockerfile');
const SCRIPTS = fileURLToPath(new URL('.', import.meta.url));
const PACKAGE = fileURLToPath(new URL('../package.json', import.meta.url));

if (!existsSync(DOCKERFILE)) {
  // Бежим не из репозитория (сам образ, распакованный архив) — проверять нечего.
  console.log('сборка образа: Dockerfile недоступен, проверка пропущена');
  process.exit(0);
}

const dockerfile = readFileSync(DOCKERFILE, 'utf8');
const called = dockerfile.match(/RUN npm run ([\w:-]+)/);
if (!called) {
  console.error('в infra/nginx/Dockerfile не нашлось `RUN npm run …` — сторож смотрит не туда');
  process.exit(1);
}
const target = called[1];

const scripts = JSON.parse(readFileSync(PACKAGE, 'utf8')).scripts ?? {};
const command = scripts[target];
if (!command) {
  console.error(`Dockerfile зовёт \`npm run ${target}\`, а такой цели в package.json нет.`);
  process.exit(1);
}

// Скрипты, которым нужен бэкенд, узнаём по их же тексту, а не по списку имён:
// список разъезжается молча, ровно как разъехался бы этот сторож.
//
// Ищем ПУТЬ, а не упоминание: слова «backend/apps» есть и в этом файле — в
// объяснении, — и наивный поиск подстроки заносил сторожа в собственный список.
const SELF = 'check-image-build.mjs';
const USES_BACKEND = /['"`][^'"`]*backend\/apps/;
const needBackend = readdirSync(SCRIPTS)
  .filter((name) => name.endsWith('.mjs') && name !== SELF)
  .filter((name) => USES_BACKEND.test(readFileSync(join(SCRIPTS, name), 'utf8')));

if (!needBackend.length) {
  console.error('ни один сторож не читает backend/apps — проверка потеряла смысл');
  process.exit(1);
}

const offenders = needBackend.filter((name) => command.includes(name));
if (offenders.length) {
  console.error(
    `Цель \`${target}\` зовёт ${offenders.join(', ')}, а этому скрипту нужны исходники бэкенда,\n` +
      'которых в образе фронта нет: Dockerfile копирует только frontend/.\n' +
      'Прод-образ на этом не соберётся. Такие сторожа живут в `npm run build` —\n' +
      'у разработчика и в CI, где репозиторий на месте целиком.',
  );
  process.exit(1);
}

console.log(`сборка образа: цель \`${target}\` обходится без исходников бэкенда`);
