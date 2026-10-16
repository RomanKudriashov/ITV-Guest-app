import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/**
 * ВКЛЮЧАТЕЛЬ СТЕКЛА ДЛЯ ОБОЛОЧКИ (партия 56, шаг 1 — образцы).
 *
 * Стеклянную рамку (меню, шапку, подложку) рисует оболочка, а решает экран:
 * пока стиль раскатан только на образцы, экран-образец включает стекло на
 * время, пока открыт, и выключает уходя. Остальные экраны не меняются.
 * После раскатки включатель уйдёт: стекло станет видом оболочки всегда.
 */
const GlassContext = createContext<{ on: boolean; set: (on: boolean) => void }>({ on: false, set: () => {} });

/**
 * Оболочка держит состояние у себя (ей же его и читать) и отдаёт включатель
 * экранам ниже: `const glass = useGlassState()` → `<GlassScope value={glass}>`.
 */
export function useGlassState(): { on: boolean; set: (on: boolean) => void } {
  const [on, set] = useState(false);
  return { on, set };
}

export function GlassScope({ value, children }: { value: { on: boolean; set: (on: boolean) => void }; children: ReactNode }) {
  return <GlassContext.Provider value={value}>{children}</GlassContext.Provider>;
}

/** Экран-образец: включить стекло, пока он открыт. */
export function useGlassPage(): void {
  const { set } = useContext(GlassContext);
  useEffect(() => {
    set(true);
    return () => set(false);
  }, [set]);
}
