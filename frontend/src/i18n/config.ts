import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en.json';
import ru from './locales/ru.json';
import ar from './locales/ar.json';
import zh from './locales/zh.json';

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

export const LANGUAGE_STORAGE_KEY = 'itv.lang';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ru: { translation: ru },
      ar: { translation: ar },
      zh: { translation: zh },
    },
    supportedLngs: [...SUPPORTED_LANGUAGES],
    fallbackLng: 'en',
    // 'ru-RU' should resolve to 'ru'.
    load: 'languageOnly',
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false },
    detection: {
      order: ['querystring', 'localStorage', 'navigator'],
      lookupQuerystring: 'lang',
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ['localStorage'],
    },
  });

export default i18n;
