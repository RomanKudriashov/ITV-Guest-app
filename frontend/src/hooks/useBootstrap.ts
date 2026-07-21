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

/** Content languages come from bootstrap, not from the UI language list. */
export function useContentLanguages(bootstrap: Bootstrap | undefined): ContentLanguages {
  const { i18n } = useTranslation();
  const uiLanguage = (i18n.resolvedLanguage ?? i18n.language ?? 'en').split('-')[0];

  const languages = bootstrap?.languages ?? [];
  const codes = languages.length ? languages.map((l) => l.code) : ['ru'];
  const defaultCode =
    bootstrap?.hotel?.default_language ??
    languages.find((l) => l.is_default)?.code ??
    codes[0];

  const labels: Record<string, string> = {};
  for (const language of languages) labels[language.code] = language.title || language.code;

  return {
    codes,
    defaultCode,
    labels,
    displayLanguage: codes.includes(uiLanguage) ? uiLanguage : defaultCode,
  };
}
