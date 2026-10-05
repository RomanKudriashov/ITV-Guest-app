import { createInstance } from 'i18next';

import { dictionaryBackend, fallbackFor, SUPPORTED_LANGUAGES } from '@/i18n/config';

/**
 * A SEPARATE i18next instance for the brand preview. It lets the preview switch
 * to Arabic (RTL) without changing the language of the CMS session around it —
 * the preview is a window into the guest app, not part of the operator's UI.
 *
 * It is deliberately NOT wired through `initReactI18next`: that plugin sets the
 * GLOBAL default instance for react-i18next, which would hijack the rest of the
 * app. The preview receives this instance through `<I18nextProvider>` instead.
 *
 * СЛОВАРИ — ПО ТРЕБОВАНИЮ (партия 35, п.65). Раньше здесь статически лежали все
 * четыре, и из-за этого их качал каждый, кто открыл панель, — даже форму входа.
 * Теперь экземпляр поднимается при первом показе и берёт только нужный язык;
 * показ рисуется, когда `loadPreviewLanguage` исполнилось.
 */
export const previewI18n = createInstance();

let started: Promise<unknown> | null = null;

/** Загрузить словарь языка показа и переключиться на него. */
export function loadPreviewLanguage(language: string): Promise<unknown> {
  started ??= previewI18n.use(dictionaryBackend).init({
    lng: language,
    fallbackLng: fallbackFor,
    load: 'languageOnly',
    supportedLngs: [...SUPPORTED_LANGUAGES],
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
  return started.then(() => previewI18n.changeLanguage(language));
}
