import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError } from '@/api/client';
import { PlatformError } from '@/admin/adminClient';
import { useToast } from '@/components/ToastProvider';

/**
 * ОТКАЗ ВИДЕН ВСЕГДА.
 *
 * Правило простое: действие либо выполнилось и это видно, либо отказано и
 * сказано почему. Третьего — «нажал, и ничего» — быть не должно.
 *
 * Так было в десяти местах консоли и CMS: мутация объявляла только `onSuccess`,
 * а отказ уходил в пустоту. Самый дорогой случай — панель тарифа: роль без
 * права получала 403, экран не менялся никак, и оператор уходил уверенный, что
 * тариф записан.
 *
 * Один обработчик на все места, а не десять своих: иначе каждое место
 * заводит своё мнение о том, что показывать, и половина снова промолчит.
 *
 * ТЕКСТ БЕРЁМ У СЕРВЕРА. Он объясняет причину («нужна роль владельца», «у
 * отеля есть заказы»), а подменять это своим «не получилось» значит выбросить
 * единственное, что помогает понять, что делать дальше. Своя фраза — только
 * когда сервер не сказал ничего (сеть, таймаут).
 */
export function useActionFailed(): (error: unknown) => void {
  const { t } = useTranslation();
  const toast = useToast();

  return useCallback(
    (error: unknown) => {
      const detail =
        error instanceof ApiError
          ? error.detail
          : error instanceof PlatformError
            ? error.message
            : error instanceof Error && error.message
              ? error.message
              : '';
      toast.show(detail || t('errors.generic'), 'error');
    },
    [t, toast],
  );
}
