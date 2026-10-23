import { useEffect, useState } from 'react';

import i18n, { loadControlDictionary } from './config';

/**
 * Строки Control готовы для текущего языка (партия 63-1): до первого кадра
 * Control и после каждой смены языка. Пока `false` — Control не рисуется,
 * иначе первый кадр показал бы ключи вместо слов.
 */
export function useControlDictionary(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = (language?: string) =>
      loadControlDictionary(language ?? i18n.resolvedLanguage ?? i18n.language).then(
        () => alive && setReady(true),
        () => alive && setReady(true),
      );
    void load();
    i18n.on('languageChanged', load);
    return () => {
      alive = false;
      i18n.off('languageChanged', load);
    };
  }, []);
  return ready;
}
