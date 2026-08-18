import { useCallback, useEffect, useRef } from 'react';

/**
 * Черновик формы: переживает смерть сессии и возвращается после входа.
 *
 * ПОЧЕМУ ЧЕРНОВИК, А НЕ ЗАДЕРЖКА ВЫХОДА ДО ДИАЛОГА. Задержка не решает задачу,
 * а переставляет её: к моменту, когда сессия умерла, сохранить уже нечем —
 * сервер отвечает 401 на всё. Диалог «у вас несохранённое» без работающей
 * кнопки «сохранить» — это тот самый мёртвый экран, от которого мы уходили, и
 * он же ломается от случайно закрытой вкладки. Черновик в браузере переживает
 * и уход на вход, и закрытие вкладки, и перезагрузку.
 *
 * Ограничения, встроенные в ключ и в жизненный цикл:
 *   * ключ включает ПОЛЬЗОВАТЕЛЯ — на общем компьютере чужой черновик не
 *     всплывёт: у другого человека другой ключ, а до входа ключа нет вовсе;
 *   * успешное сохранение черновик стирает — иначе он всплывал бы поверх уже
 *     сохранённого и «возвращал» отменённые правки;
 *   * в черновик кладут ТОЛЬКО поля формы. Пароли и PIN сюда не попадают:
 *     формы входа и смены пароля этот хук не используют, и не должны.
 */

const PREFIX = 'itv.draft';

function storageKey(scope: string, userId: string | null | undefined, screen: string): string | null {
  // Нет пользователя — нет ключа. Писать черновик «ничей» значит однажды
  // показать его тому, кто сядет за этот компьютер следующим.
  if (!userId) return null;
  return `${PREFIX}.${scope}.${userId}.${screen}`;
}

export interface FormDraft<T> {
  /** Запомнить текущее состояние формы. Зовётся на каждое изменение. */
  save: (value: T) => void;
  /** Забрать отложенное (и НЕ стирать — стирает `discard`). */
  restore: () => T | null;
  /** Черновик больше не нужен: сохранили или ушли осознанно. */
  discard: () => void;
}

export function useFormDraft<T>({
  scope,
  userId,
  screen,
  enabled = true,
}: {
  /** Область: `cms` или `platform` — у них разные пользователи. */
  scope: string;
  userId: string | null | undefined;
  /** Что редактируем: `item:<id>`, `hotel:<id>`. Ключ экрана, а не адреса. */
  screen: string;
  enabled?: boolean;
}): FormDraft<T> {
  const key = storageKey(scope, userId, screen);
  // Ключ в ref: `save` зовут из обработчиков, и пересоздавать её на каждый
  // рендер значило бы дёргать эффекты, которые от неё зависят.
  const keyRef = useRef(key);
  useEffect(() => {
    keyRef.current = key;
  }, [key]);

  const save = useCallback(
    (value: T) => {
      if (!enabled || !keyRef.current) return;
      try {
        window.localStorage.setItem(keyRef.current, JSON.stringify(value));
      } catch {
        /* приватный режим или переполнение — черновик не критичен */
      }
    },
    [enabled],
  );

  const restore = useCallback((): T | null => {
    if (!enabled || !keyRef.current) return null;
    try {
      const raw = window.localStorage.getItem(keyRef.current);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }, [enabled]);

  const discard = useCallback(() => {
    if (!keyRef.current) return;
    try {
      window.localStorage.removeItem(keyRef.current);
    } catch {
      /* ignore */
    }
  }, []);

  return { save, restore, discard };
}

/**
 * Убрать все черновики области — на выходе «везде» и при смене пользователя.
 *
 * Обычный выход черновики НЕ трогает: человек вышел на ночь, утром вернулся и
 * дописал. А вот «выйти везде» — это ответ на кражу, и оставлять после него
 * содержимое форм в чужом браузере незачем.
 */
export function dropAllDrafts(scope: string): void {
  try {
    const prefix = `${PREFIX}.${scope}.`;
    const doomed = Object.keys(window.localStorage).filter((k) => k.startsWith(prefix));
    doomed.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}
