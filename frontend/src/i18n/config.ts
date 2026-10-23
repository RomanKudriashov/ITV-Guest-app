import i18n, { type BackendModule, type ResourceKey } from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import { STORAGE_KEYS } from '@/storageKeys';

export const SUPPORTED_LANGUAGES = ['en', 'ru', 'ar', 'zh'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** Languages rendered right-to-left. */
export const RTL_LANGUAGES = ['ar', 'he', 'fa', 'ur'] as const;

/** Native names for the language switcher (not translated on purpose). */
export const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: 'English',
  ru: 'Русский',
  ar: 'العربية',
  zh: '中文',
};

/** 'ar-SA' -> 'rtl'. Accepts any i18next language tag. */
export function directionForLanguage(lng: string | undefined): 'ltr' | 'rtl' {
  const base = (lng ?? '').toLowerCase().split('-')[0];
  return (RTL_LANGUAGES as readonly string[]).includes(base) ? 'rtl' : 'ltr';
}

export const LANGUAGE_STORAGE_KEY = STORAGE_KEYS.language;

/*
  ЯЗЫК ПРИЕЗЖАЕТ ОДИН — ТОТ, НА КОТОРОМ ГОВОРЯТ (партия 35, п.65).

  Все четыре словаря лежали во входном файле: 476 КБ из 950, и каждый гость
  качал арабский, китайский и строки всей панели на трёх лишних языках. Теперь
  словарь — свой файл на язык и грузится по требованию: первый — до первого
  кадра (`i18nReady`, его ждёт `main.tsx`), следующий — при смене языка
  (`changeLanguage` сам дожидается словаря и только потом переключает экран).

  Запасной английский — ТОЛЬКО для языка, которого у нас нет. Для своих
  четырёх запасного нет: полноту ключей во всех языках держит сторож
  `scripts/check-locales.mjs`, и тянуть английский словарь русскому гостю
  «на всякий случай» значило бы вернуть половину сэкономленного.
*/
const DICTIONARIES: Record<SupportedLanguage, () => Promise<{ default: ResourceKey }>> = {
  en: () => import('./locales/en.json'),
  ru: () => import('./locales/ru.json'),
  ar: () => import('./locales/ar.json'),
  zh: () => import('./locales/zh.json'),
};

/*
  СТРОКИ CONTROL — СВОИМ СЛОВАРЁМ (партия 63-1).

  Ветка `admin.*` жила в общем словаре, и гость по QR качал вместе со своими
  строками весь Control: окно номера, корпуса, журнал — треть файла. Теперь
  она в `locales/admin/<язык>.json` и грузится только там, где есть Control
  (`/admin` и его песочница): `useControlDictionary` догружает словарь до
  первого кадра и при смене языка. Паритет ключей держит `check-locales`.
*/
const CONTROL_DICTIONARIES: Record<SupportedLanguage, () => Promise<{ default: ResourceKey }>> = {
  en: () => import('./locales/admin/en.json'),
  ru: () => import('./locales/admin/ru.json'),
  ar: () => import('./locales/admin/ar.json'),
  zh: () => import('./locales/admin/zh.json'),
};

const controlLoaded = new Set<string>();

/** Догрузить строки Control для языка; повторный вызов — сразу. */
export async function loadControlDictionary(language: string | undefined): Promise<void> {
  const code = (language ?? '').toLowerCase().split('-')[0] as SupportedLanguage;
  const load = CONTROL_DICTIONARIES[code] ?? CONTROL_DICTIONARIES.en;
  const key = CONTROL_DICTIONARIES[code] ? code : 'en';
  if (controlLoaded.has(key)) return;
  const module = await load();
  i18n.addResourceBundle(key, 'translation', module.default, true, false);
  controlLoaded.add(key);
}

/** Загрузчик словарей — общий с показом бренда (`cms/brand/previewI18n.ts`). */
export const dictionaryBackend: BackendModule = {
  type: 'backend',
  init: () => undefined,
  read(language, _namespace, callback) {
    const load = DICTIONARIES[language as SupportedLanguage];
    if (!load) {
      callback(null, {});
      return;
    }
    load().then(
      (module) => callback(null, module.default),
      (error: unknown) => callback(error as Error, null),
    );
  },
};

const isSupported = (code: string | undefined) =>
  (SUPPORTED_LANGUAGES as readonly string[]).includes((code ?? '').toLowerCase().split('-')[0]);

/** Запасной язык: английский — только для языка, которого у нас нет. */
export const fallbackFor = (code: string) => (isSupported(code) ? [] : ['en']);

/** Словарь выбранного языка загружен — можно рисовать. */
export const i18nReady: Promise<unknown> = i18n
  .use(dictionaryBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    supportedLngs: [...SUPPORTED_LANGUAGES],
    fallbackLng: fallbackFor,
    // 'ru-RU' should resolve to 'ru'.
    load: 'languageOnly',
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false },
    // Первый кадр рисуется после `i18nReady`, смена языка переключает экран
    // уже с загруженным словарём — ждать внутри компонентов нечего, а
    // приостановка выше всех границ уронила бы корень.
    // `added`: догруженный словарь Control перерисовывает экраны сам.
    react: { useSuspense: false, bindI18nStore: 'added' },
    detection: {
      order: ['querystring', 'localStorage', 'navigator'],
      lookupQuerystring: 'lang',
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ['localStorage'],
    },
  });

export default i18n;
