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
import type { GuestHotel } from '@/guest/api/types';
import { cacheKeyFor, type PreviewPayloadId, type PreviewScreen } from './previewScreens';

export interface PreviewData {
  client: QueryClient;
  /** Данные ещё едут — показ рисует скелет витрины, а не пустоту. */
  isLoading: boolean;
  /** Экран не собрался: сервер отказал или данных у отеля нет. */
  error: unknown;
  /**
   * Код заведения, которое выбрал СЕРВЕР, — по нему открывается адрес экрана.
   *
   * `null` — у отеля нет гостевых заведений: показывать каталог нечем, и это
   * честный ответ, а не поломка показа.
   */
  venue: string | null;
  /**
   * Отель — тот же, что гость получает до входа (партия 24). Нужен сессии
   * показа: без него номер читал «управление выключено», главная — «обложки
   * нет». Приходит на каждом экране: сессия одна на всю витрину.
   */
  hotel: GuestHotel | null;
  /** Позиция, которую выбрал сервер для экрана карточки; `null` — не этот экран. */
  item: string | null;
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
  const [venue, setVenue] = useState<string | null>(null);
  const [hotel, setHotel] = useState<GuestHotel | null>(null);
  const [item, setItem] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    const ids: PreviewPayloadId[] = ['hotel', ...screen.payloads];
    Promise.all(ids.map((id) => fetchPreviewScreen(id).then((data) => [id, data] as const)))
      .then((pairs) => {
        if (!alive) return;
        let point: string | null = null;
        let chosen: string | null = null;
        for (const [id, data] of pairs) {
          if (id === 'hotel') {
            setHotel(data as GuestHotel);
            continue;
          }
          if (id === 'item') {
            // Ключ карточки собирается из полученного идентификатора — заранее
            // его знать неоткуда, позицию выбирает сервер.
            const item = data as { id?: string };
            if (item?.id) client.setQueryData(guestKeys.item(item.id, language), data);
            chosen = item?.id ?? null;
            continue;
          }
          if (id === 'catalog') {
            // ЗАВЕДЕНИЕ НАЗЫВАЕТ ОТВЕТ, а не показ. Ключ кэша у экрана
            // заведения включает код, и взять его можно только оттуда же,
            // откуда взялся сам каталог, — иначе экран ищет свой ответ по
            // другому ключу и не находит ничего.
            point = (data as { venue?: { code?: string } }).venue?.code ?? null;
            // Кода нет — гостевых заведений у отеля нет, и сервер честно
            // ответил пусто. Класть это в кэш не подо что: экран не откроется.
            if (!point) continue;
            const key = cacheKeyFor('catalog', language, point);
            if (key) client.setQueryData(key, data);
            continue;
          }
          const key = cacheKeyFor(id, language);
          if (key) client.setQueryData(key, data);
        }
        setVenue(point);
        setItem(chosen);
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

  return { client, isLoading, error, venue, hotel, item };
}
