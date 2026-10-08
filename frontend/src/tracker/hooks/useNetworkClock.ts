import { useEffect, useState } from 'react';

/**
 * СЕТЬ БРАУЗЕРА И ЧАСЫ ДЛЯ ПОДПИСИ СВЯЗИ (партия 44, п.77).
 *
 * Подпись под доской считала свежесть по `Date.now()` в момент рендера. Когда
 * браузер знает, что сети нет (`navigator.onLine === false`), React Query
 * ставит опрос на паузу: ни запроса, ни ошибки, ни рендера — и подпись
 * застывала на «пока обновляем раз в 15 секунд», хотя не обновлялось ничего.
 *
 * Здесь два источника рендера, не зависящих от запросов: события браузера
 * `online`/`offline` — сразу, и тик часов, пока доска не на сокете, — чтобы
 * свежесть опроса пересчитывалась сама.
 */
export function useNetworkClock(ticking: boolean, tickMs = 2_000): { online: boolean; now: number } {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const up = () => {
      setOnline(true);
      setNow(Date.now());
    };
    const down = () => {
      setOnline(false);
      setNow(Date.now());
    };
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  useEffect(() => {
    if (!ticking) return;
    const timer = window.setInterval(() => setNow(Date.now()), tickMs);
    return () => window.clearInterval(timer);
  }, [ticking, tickMs]);

  return { online, now };
}
