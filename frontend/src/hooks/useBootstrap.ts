import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { fetchBootstrap } from '@/api/cms';
import { queryKeys } from '@/api/queryKeys';
import type { Bootstrap } from '@/api/types';

/** CMS bootstrap — everything the editors need before the first render. */
export function useBootstrap() {
  return useQuery<Bootstrap>({
    queryKey: queryKeys.bootstrap,
    queryFn: fetchBootstrap,
    staleTime: 5 * 60 * 1000,
  });
}

export interface ContentLanguages {
  /** Language codes offered by the hotel for content translation. */
  codes: string[];
  /** Hotel default — a title must be filled at least in this language. */
  defaultCode: string;
  labels: Record<string, string>;
  /** Language used to render already-saved content in lists. */
  displayLanguage: string;
}

/**
 * Языки контента ИЗ ГОЛОГО СПИСКА, без привязки к тому, кто его принёс.
 *
 * Экраны управления номером живут в двух консолях: у CMS список приезжает
 * `/cms/bootstrap`, у платформенной — в карточке отеля. Считать их из
 * бутстрапа значило бы намертво привязать экраны к ручке, которой у второй
 * стороны нет вовсе, — на этом мы уже упёрлись: конструктор в консоли получал
 * 401 и уводил оператора на вход отеля.
 */
export function contentLanguagesFrom(
  languages: Array<{ code: string; title?: string; is_default?: boolean }> | undefined,
  defaultLanguage: string | undefined,
  uiLanguage: string,
): ContentLanguages {
  const list = languages ?? [];
  const codes = list.length ? list.map((l) => l.code) : ['ru'];
  const defaultCode = defaultLanguage ?? list.find((l) => l.is_default)?.code ?? codes[0];

  const labels: Record<string, string> = {};
  for (const language of list) labels[language.code] = language.title || language.code;

  return {
    codes,
    defaultCode,
    labels,
    displayLanguage: codes.includes(uiLanguage) ? uiLanguage : defaultCode,
  };
}

/** Content languages come from bootstrap, not from the UI language list. */
export function useContentLanguages(bootstrap: Bootstrap | undefined): ContentLanguages {
  const { i18n } = useTranslation();
  const uiLanguage = (i18n.resolvedLanguage ?? i18n.language ?? 'en').split('-')[0];

  return contentLanguagesFrom(
    bootstrap?.languages,
    bootstrap?.hotel?.default_language,
    uiLanguage,
  );
}
