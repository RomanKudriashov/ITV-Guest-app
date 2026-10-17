import { useSyncExternalStore } from 'react';

import { STORAGE_KEYS } from '@/storageKeys';

/**
 * ВИД МЕНЮ ГОСТЯ (партия 57): «карточки» или «мозаика».
 *
 * Выбор гостя — ОДИН на всё приложение и сильнее настройки заведения: гость,
 * переключивший мозаику в ресторане, ждёт её и в баре. Пока гость не выбирал,
 * действует вид заведения (`venue.menu_view`), а у заведения без вида —
 * «карточки».
 *
 * Стор модульный, без провайдера: переключатель живёт в шапке заведения, а
 * применяется в каталоге — двум соседям нужен один источник. Хранилище может
 * быть недоступно (приватное окно, запрет данных сайта) — тогда выбор живёт до
 * перезагрузки, а не роняет витрину.
 */
export type MenuView = 'cards' | 'mosaic';
export const MENU_VIEWS: readonly MenuView[] = ['cards', 'mosaic'];
export const DEFAULT_MENU_VIEW: MenuView = 'cards';

export function isMenuView(value: unknown): value is MenuView {
  return value === 'cards' || value === 'mosaic';
}

/** Какой вид показать: выбор гостя → вид заведения → «карточки». */
export function resolveMenuView(
  guestChoice: MenuView | null,
  venueDefault: string | null | undefined,
): MenuView {
  if (guestChoice) return guestChoice;
  return isMenuView(venueDefault) ? venueDefault : DEFAULT_MENU_VIEW;
}

export interface KeyValueStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

/** Выбор гостя из хранилища; нет, мусор или хранилище бросает — `null`. */
export function readMenuViewChoice(storage: KeyValueStorage | null | undefined): MenuView | null {
  try {
    const value = storage?.getItem(STORAGE_KEYS.guestMenuView);
    return isMenuView(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeMenuViewChoice(storage: KeyValueStorage | null | undefined, view: MenuView): void {
  try {
    storage?.setItem(STORAGE_KEYS.guestMenuView, view);
  } catch {
    /* без памяти — выбор живёт до перезагрузки */
  }
}

function browserStorage(): KeyValueStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

let current: MenuView | null = readMenuViewChoice(browserStorage());
const listeners = new Set<() => void>();

export function setMenuViewChoice(view: MenuView): void {
  if (!isMenuView(view)) return;
  writeMenuViewChoice(browserStorage(), view);
  if (view === current) return;
  current = view;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Выбор гостя (`null` — не выбирал) и установщик. */
export function useMenuViewChoice(): [MenuView | null, (view: MenuView) => void] {
  const choice = useSyncExternalStore(subscribe, () => current, () => null);
  return [choice, setMenuViewChoice];
}
