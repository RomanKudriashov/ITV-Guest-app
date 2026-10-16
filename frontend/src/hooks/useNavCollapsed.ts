import { useCallback, useState } from 'react';

/**
 * Свёрнуто ли левое меню до иконок — выбор человека, переживает перезагрузку
 * (партия 55).
 *
 * По умолчанию меню РАЗВЁРНУТО: свёрнутое — режим для тех, кто разделы уже
 * знает в лицо. Хранилище может быть недоступно (приватное окно, запрет
 * сайта) — тогда выбор живёт до перезагрузки, а не роняет оболочку.
 * Мобильной шторки это не касается: она всегда полная, решает вызывающий.
 */
export function useNavCollapsed(key: string): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        if (next) window.localStorage.setItem(key, '1');
        else window.localStorage.removeItem(key);
      } catch {
        // Хранилище закрыто — выбор действует до перезагрузки.
      }
      return next;
    });
  }, [key]);

  return [collapsed, toggle];
}
