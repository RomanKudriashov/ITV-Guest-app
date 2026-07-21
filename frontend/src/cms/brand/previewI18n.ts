import { createInstance } from 'i18next';

import en from '@/i18n/locales/en.json';
import ru from '@/i18n/locales/ru.json';
import ar from '@/i18n/locales/ar.json';
import zh from '@/i18n/locales/zh.json';

/**
 * A SEPARATE i18next instance for the brand preview. It lets the preview switch
 * to Arabic (RTL) without changing the language of the CMS session around it —
 * the preview is a window into the guest app, not part of the operator's UI.
 *
 * It is deliberately NOT wired through `initReactI18next`: that plugin sets the
 * GLOBAL default instance for react-i18next, which would hijack the rest of the
 * app. The preview receives this instance through `<I18nextProvider>` instead.
 */
export const previewI18n = createInstance();

void previewI18n.init({
  resources: {
    en: { translation: en },
    ru: { translation: ru },
    ar: { translation: ar },
    zh: { translation: zh },
  },
  lng: 'en',
  fallbackLng: 'en',
  load: 'languageOnly',
  supportedLngs: ['en', 'ru', 'ar', 'zh'],
  nonExplicitSupportedLngs: true,
  interpolation: { escapeValue: false },
});
