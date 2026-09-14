/**
 * ДАННЫЕ ПОКАЗА — В КЭШ, ПОД ГОСТЕВЫМИ КЛЮЧАМИ.
 *
 * Показ рисует настоящие экраны витрины, а те спрашивают свои данные через
 * `useQuery` с гостевыми ключами. Дать им данные можно двумя способами:
 * завести гостевую сессию (и плодить гостей, которых не было) или положить
 * ответ в кэш под тем же ключом. Выбран второй.
 *
 * ЗАПРОСЫ ПРИ ЭТОМ НЕ УХОДЯТ ВОВСЕ — и держится это на устройстве, а не на
 * внимательности: умолчание запроса у этого клиента ОТКАЗ. Что положено в кэш,
 * то и рисуется; чего не положено, то честно падает в состояние ошибки, а не
 * уходит в гостевую ручку без токена.
 *
 * КЛИЕНТ ОТДЕЛЬНЫЙ, а не общий с панелью: ключи у витрины свои
 * (`['guest', …]`), но держать их в кэше панели значило бы однажды показать
 * оператору гостевые данные там, где он их не ждёт.
 */

import { useEffect, useMemo, useState } from 'react';
import { QueryClient } from '@tanstack/react-query';

import { fetchPreviewScreen } from '@/api/brand';
import { guestKeys } from '@/guest/api/queryKeys';
import type { PreviewScreen } from './previewScreens';

export interface PreviewData {
  client: QueryClient;
  /** Данные ещё едут — показ рисует скелет витрины, а не пустоту. */
  isLoading: boolean;
  /** Экран не собрался: сервер отказал или данных у отеля нет. */
  error: unknown;
}

export function usePreviewData(screen: PreviewScreen, language: string): PreviewData {
  const client = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            /*
              ПОКАЗ НЕ ХОДИТ В ГОСТЕВЫЕ РУЧКИ ВООБЩЕ.

              Умолчание запроса — отказ. Всё, что показу нужно, кладётся в кэш
              серверной ручкой панели; всё остальное честно падает в состояние
              ошибки, а не уходит в гостевую ручку без токена и не получает
              оттуда 401. Так обещание «ни одного гостевого запроса» держится
              не на внимательности, а на устройстве.
            */
            queryFn: () => Promise.reject(new Error('показ не ходит в гостевые ручки')),
            retry: false,
            // Данные кладём руками; сами запросы в показе не ходят.
            staleTime: Infinity,
            gcTime: Infinity,
            refetchOnWindowFocus: false,
          },
        },
      }),
    [],
  );
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    Promise.all(screen.payloads.map((id) => fetchPreviewScreen(id).then((data) => [id, data] as const)))
      .then((pairs) => {
        if (!alive) return;
        for (const [id, data] of pairs) {
          switch (id) {
            case 'home':
              client.setQueryData(guestKeys.home(language), data);
              break;
            case 'venues':
              client.setQueryData(guestKeys.venues('restaurants', language), data);
              break;
            case 'catalog':
              // Тот же ключ, что попросит экран заведения: тип товарный,
              // заведение — то, чей адрес открыт показом.
              client.setQueryData(guestKeys.catalog('product', language, 'kitchen'), data);
              break;
            case 'item': {
              const item = data as { id?: string };
              if (item?.id) client.setQueryData(guestKeys.item(item.id, language), data);
              break;
            }
            case 'locations':
              client.setQueryData(guestKeys.locations(language), data);
              break;
            case 'room':
              client.setQueryData(guestKeys.room, data);
              break;
          }
        }
        setLoading(false);
      })
      .catch((reason) => {
        if (!alive) return;
        setError(reason);
        setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [client, screen, language]);

  return { client, isLoading, error };
}
