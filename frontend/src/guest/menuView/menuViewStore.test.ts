import { describe, expect, it } from 'vitest';

import { STORAGE_KEYS } from '@/storageKeys';
import { readMenuViewChoice, resolveMenuView, writeMenuViewChoice } from './menuViewStore';

function memory(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
}

const broken = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceeded');
  },
};

describe('вид меню', () => {
  it('по умолчанию — карточки', () => {
    expect(resolveMenuView(null, null)).toBe('cards');
    expect(resolveMenuView(null, undefined)).toBe('cards');
    expect(resolveMenuView(null, 'grid')).toBe('cards');
  });

  it('вид заведения действует, пока гость не выбрал', () => {
    expect(resolveMenuView(null, 'mosaic')).toBe('mosaic');
  });

  it('выбор гостя сильнее заведения', () => {
    expect(resolveMenuView('cards', 'mosaic')).toBe('cards');
    expect(resolveMenuView('mosaic', 'cards')).toBe('mosaic');
  });

  it('хранилище: чтение и запись по ключу из storageKeys', () => {
    const store = memory();
    expect(readMenuViewChoice(store)).toBeNull();
    writeMenuViewChoice(store, 'mosaic');
    expect(store.data[STORAGE_KEYS.guestMenuView]).toBe('mosaic');
    expect(readMenuViewChoice(store)).toBe('mosaic');
  });

  it('мусор в хранилище — как «не выбирал»', () => {
    expect(readMenuViewChoice(memory({ [STORAGE_KEYS.guestMenuView]: 'gallery' }))).toBeNull();
  });

  it('хранилище бросает — не падаем', () => {
    expect(readMenuViewChoice(broken)).toBeNull();
    expect(() => writeMenuViewChoice(broken, 'cards')).not.toThrow();
    expect(readMenuViewChoice(null)).toBeNull();
  });
});
