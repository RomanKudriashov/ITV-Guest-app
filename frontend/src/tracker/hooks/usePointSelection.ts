import { useCallback, useEffect, useState } from 'react';

import type { TrackerPoint } from '../api/types';

const STORAGE_KEY = 'itv.tracker.point';

function stored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Which point of execution the board shows. Remembered per device: a phone that
 * lives in the kitchen should reopen on the kitchen, not ask again every shift.
 * The stored code is honoured only while the staff member is still assigned to it.
 */
export function usePointSelection(points: TrackerPoint[] | undefined) {
  const [selected, setSelected] = useState<string | null>(() => stored());

  useEffect(() => {
    if (!points) return;
    const known = points.some((point) => point.code === selected);
    if (known) return;
    setSelected(points.length ? points[0].code : null);
  }, [points, selected]);

  const select = useCallback((code: string) => {
    setSelected(code);
    try {
      window.localStorage.setItem(STORAGE_KEY, code);
    } catch {
      /* storage unavailable */
    }
  }, []);

  return { selected: selected ?? undefined, select };
}
