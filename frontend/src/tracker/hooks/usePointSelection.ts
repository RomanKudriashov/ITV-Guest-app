import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import type { TrackerPoint } from '../api/types';

const STORAGE_KEY = 'itv.tracker.point';
const URL_PARAM = 'point';

function stored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function remember(code: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, code);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Which point of execution the board shows. Remembered per device: a phone that
 * lives in the kitchen should reopen on the kitchen, not ask again every shift.
 * The stored code is honoured only while the staff member is still assigned to it.
 *
 * ПОРЯДОК: ТОЧКА ИЗ АДРЕСА → СОХРАНЁННЫЙ ВЫБОР → ПЕРВАЯ ДОСТУПНАЯ.
 *
 * Пульт ведёт с карточки заведения на `/tracker?point=concierge`, а доска
 * адрес не читала вовсе: открывался сохранённый выбор или первая точка —
 * «Консьерж» на пульте показывал пустой «Лобби-бар» (бэклог, пункт 49).
 *
 *   • точка из адреса доступна — она и открывается, и становится выбором
 *     (как если бы её выбрали в селекторе); параметр из адреса убирается,
 *     иначе при обновлении он перебивал бы следующий выбор в селекторе;
 *   • недоступна или не существует — другую доску МОЛЧА не подменяем:
 *     `refused` несёт код, экран говорит «эта доска вам недоступна» и
 *     показывает свою.
 */
export function usePointSelection(points: TrackerPoint[] | undefined) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get(URL_PARAM);
  const [selected, setSelected] = useState<string | null>(() => stored());
  const [refused, setRefused] = useState<string | null>(null);

  useEffect(() => {
    if (!points) return;
    if (requested) {
      if (points.some((point) => point.code === requested)) {
        setSelected(requested);
        remember(requested);
        setRefused(null);
      } else {
        setRefused(requested);
      }
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.delete(URL_PARAM);
          return next;
        },
        { replace: true },
      );
      return;
    }
    const known = points.some((point) => point.code === selected);
    if (known) return;
    setSelected(points.length ? points[0].code : null);
  }, [points, requested, selected, setSearchParams]);

  const select = useCallback((code: string) => {
    setSelected(code);
    setRefused(null);
    remember(code);
  }, []);

  const dismissRefused = useCallback(() => setRefused(null), []);

  return { selected: selected ?? undefined, select, refused, dismissRefused };
}
