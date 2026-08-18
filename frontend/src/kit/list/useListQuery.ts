import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Состояние списка живёт В АДРЕСЕ: поиск, фильтры, сортировка, страница.
 *
 * Зачем именно там, а не в `useState`:
 *   * ссылку с фильтром можно послать коллеге, и он увидит ТО ЖЕ САМОЕ;
 *   * F5 не сбрасывает работу — а список, который забывает фильтр на каждом
 *     обновлении, заставляет набирать его заново по десять раз за смену;
 *   * «назад» в браузере возвращает предыдущую выборку, а не выкидывает с
 *     экрана.
 *
 * Пустые значения из адреса УБИРАЮТСЯ: `?search=&status=` — это мусор, который
 * отличает две одинаковые по смыслу ссылки и мешает их сравнивать.
 */
export function useListQuery<T extends Record<string, string | number>>(
  defaults: T,
): {
  params: T;
  patch: (next: Partial<T>) => void;
  reset: () => void;
  /** Есть ли хоть один заданный фильтр — по этому различаются пустые состояния. */
  isFiltered: boolean;
} {
  const [searchParams, setSearchParams] = useSearchParams();

  const params = useMemo(() => {
    const result = { ...defaults };
    for (const key of Object.keys(defaults) as (keyof T)[]) {
      const raw = searchParams.get(String(key));
      if (raw === null) continue;
      result[key] = (
        typeof defaults[key] === 'number' ? Number(raw) || 0 : raw
      ) as T[keyof T];
    }
    return result;
    // `searchParams` — единственный источник; `defaults` задаются литералом.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const patch = useCallback(
    (next: Partial<T>) => {
      const merged = { ...params, ...next };
      /*
        Правим ТОЛЬКО свои ключи, чужие в адресе не трогаем.

        Первая версия пересобирала строку запроса с нуля из своих значений — и
        стирала всё остальное, в том числе раздел консоли: набрал букву в
        поиске, и экран уехал на «Сводку». Список распоряжается своими
        параметрами, а не всем адресом.
      */
      const search = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(merged)) {
        const isDefault = String(value) === String(defaults[key as keyof T]);
        if (value === '' || value === undefined || value === null || isDefault) {
          search.delete(key);
          continue;
        }
        search.set(key, String(value));
      }
      // `replace`: набор фильтров — это уточнение одного экрана, а не переход.
      // Иначе каждая буква в поиске оставляла бы запись в истории, и «назад»
      // пришлось бы жать столько раз, сколько букв набрали.
      setSearchParams(search, { replace: true });
    },
    [params, defaults, searchParams, setSearchParams],
  );

  /** Снять СВОИ фильтры. Чужие параметры адреса остаются — они не наши. */
  const reset = useCallback(() => {
    const search = new URLSearchParams(searchParams);
    for (const key of Object.keys(defaults)) search.delete(key);
    setSearchParams(search, { replace: true });
  }, [defaults, searchParams, setSearchParams]);

  const isFiltered = useMemo(
    () =>
      (Object.keys(defaults) as (keyof T)[]).some(
        (key) => String(params[key]) !== String(defaults[key]),
      ),
    [params, defaults],
  );

  return { params, patch, reset, isFiltered };
}
