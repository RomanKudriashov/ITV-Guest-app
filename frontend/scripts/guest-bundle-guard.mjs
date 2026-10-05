/**
 * СТОРОЖ СБОРКИ ГОСТЯ (партия 35, п.65).
 *
 * Гость по QR должен качать только витрину. Сторож смотрит на ГРАФ готовой
 * сборки, а не на исходники: в исходниках «гость не импортирует панель» можно
 * соблюсти буквально и всё равно притянуть её через общий модуль — граф это
 * видит, грep нет.
 *
 * Что качает гость при первом заходе: входной файл и часть `app/parts/guest`
 * со всеми их СТАТИЧЕСКИМИ импортами (ленивые внутри гостя — его выбор, они
 * приезжают по делу). В этом наборе не должно быть ни одного модуля панели,
 * трекера, консоли, лендинга и тяжёлых библиотек панели. И его вес вместе со
 * словарём одного языка (gzip — так отдаёт nginx стенда) не выше предела.
 *
 * Падает сборка — значит, падает и `build:image`, и образ стенда не соберётся.
 * Отчёт о наборе гостя пишется всегда: `GUEST_BUNDLE_REPORT=1 vite build`.
 */
import { gzipSync } from 'node:zlib';

/**
 * Предел веса витрины гостя: JS и CSS первого захода плюс самый тяжёлый
 * словарь, gzip уровня 1 (как `gzip on` nginx стенда без `gzip_comp_level`).
 * Замер «после» партии 35 — 426,7 КБ (до разделения было 845 КБ одним
 * файлом); предел — замер плюс 10 %. Вырос честно — поднять предел здесь же,
 * с причиной в коммите.
 */
export const GUEST_LIMIT_BYTES = 470 * 1024;

/** Чего у гостя быть не должно: каталоги и части панели, трекера, консоли, лендинга. */
const FORBIDDEN = [
  { re: /\/src\/cms\//, what: 'раздел панели (src/cms)' },
  { re: /\/src\/pages\/(?!WrongHostNotice\.tsx)/, what: 'экран панели (src/pages)' },
  { re: /\/src\/layouts\//, what: 'оболочка панели (src/layouts)' },
  { re: /\/src\/tracker\//, what: 'трекер (src/tracker)' },
  { re: /\/src\/admin\//, what: 'консоль платформы (src/admin)' },
  { re: /\/src\/landing\//, what: 'лендинг (src/landing)' },
  { re: /\/src\/app\/parts\/(?!guest\.ts)/, what: 'чужая часть сборки (src/app/parts)' },
  { re: /\/src\/App\.tsx$/, what: 'служебная страница темы (src/App.tsx)' },
  { re: /\/node_modules\/react-easy-crop\//, what: 'кроппер (react-easy-crop)' },
  { re: /\/node_modules\/@dnd-kit\//, what: 'перетаскивание (@dnd-kit)' },
];

const GUEST_PART = /\/src\/app\/parts\/guest\.ts$/;
/** Словари (`i18n/config.ts`): гость качает один — свой. В счёт идёт самый тяжёлый. */
const DICTIONARY = /\/src\/i18n\/locales\/[a-z]+\.json$/;

function closure(bundle, startNames) {
  const seen = new Set();
  const queue = [...startNames];
  while (queue.length) {
    const name = queue.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    const chunk = bundle[name];
    if (chunk?.type === 'chunk') queue.push(...chunk.imports);
  }
  return seen;
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} КБ`;

/** @returns {import('vite').Plugin} */
export function guestBundleGuard({ limit = GUEST_LIMIT_BYTES } = {}) {
  return {
    name: 'itv-guest-bundle-guard',
    apply: 'build',
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter((item) => item.type === 'chunk');
      const entry = chunks.filter((chunk) => chunk.isEntry);
      const guest = chunks.find((chunk) => chunk.facadeModuleId && GUEST_PART.test(chunk.facadeModuleId));
      if (!entry.length || !guest) {
        this.error('сторож сборки гостя: не нашёл входной файл или часть app/parts/guest — проверять нечего');
      }
      const names = closure(bundle, [...entry.map((chunk) => chunk.fileName), guest.fileName]);

      const offenders = [];
      const modules = [];
      let bytes = 0;
      const files = [];
      for (const name of names) {
        const chunk = bundle[name];
        if (chunk?.type !== 'chunk') continue;
        const size = gzipSync(chunk.code, { level: 1 }).length;
        bytes += size;
        files.push(`${name} ${kb(size)}`);
        for (const css of chunk.viteMetadata?.importedCss ?? []) {
          const asset = bundle[css];
          if (asset?.type === 'asset') bytes += gzipSync(asset.source, { level: 1 }).length;
        }
        for (const [id, info] of Object.entries(chunk.modules)) {
          modules.push({ id, size: info.renderedLength });
          const bad = FORBIDDEN.find((rule) => rule.re.test(id));
          if (bad) offenders.push(`${bad.what}: ${id.replace(/^.*?\/(src|node_modules)\//, '$1/')} (в ${name})`);
        }
      }

      const dictionaries = chunks.filter((chunk) => chunk.facadeModuleId && DICTIONARY.test(chunk.facadeModuleId));
      const dictionary = Math.max(0, ...dictionaries.map((chunk) => gzipSync(chunk.code, { level: 1 }).length));
      bytes += dictionary;
      files.push(`словарь до ${kb(dictionary)}`);

      if (process.env.GUEST_BUNDLE_REPORT) {
        const groups = new Map();
        for (const { id, size } of modules) {
          const key = id.includes('/node_modules/')
            ? `node_modules/${id.split('/node_modules/').pop().split('/').slice(0, id.split('/node_modules/').pop().startsWith('@') ? 2 : 1).join('/')}`
            : id.replace(/^.*?\/src\//, 'src/').split('/').slice(0, 2).join('/');
          groups.set(key, (groups.get(key) ?? 0) + size);
        }
        const top = [...groups].sort((a, b) => b[1] - a[1]).slice(0, 25);
        this.info(
          `\nнабор гостя: ${files.join(', ')} — итого ${kb(bytes)} gzip (предел ${kb(limit)})\n` +
            top.map(([key, size]) => `  ${kb(size).padStart(10)}  ${key}`).join('\n'),
        );
      }

      if (offenders.length) {
        this.error(
          `сторож сборки гостя: к гостю попал код, которого ему не надо (${offenders.length}):\n  ` +
            offenders.slice(0, 20).join('\n  '),
        );
      }
      if (bytes > limit) {
        this.error(`сторож сборки гостя: витрина гостя ${kb(bytes)} gzip — выше предела ${kb(limit)}`);
      }
    },
  };
}
