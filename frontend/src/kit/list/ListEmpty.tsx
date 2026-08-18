import { useTranslation } from 'react-i18next';
import Button from '@mui/material/Button';

import { EmptyState } from '@/components/EmptyState';

/**
 * ДВА РАЗНЫХ ПУСТЫХ СОСТОЯНИЯ — и они обязаны отличаться.
 *
 *   «здесь пока пусто»   — записей нет вообще. Ответ: заведите первую.
 *   «ничего не найдено»  — записи есть, но под фильтр не попали. Ответ:
 *                          снимите фильтр, а не заводите дубль.
 *
 * Свалить их в одно «нет данных» — значит на регулярной основе заводить
 * вторую копию записи, которая уже есть и просто отсеяна поиском. Третьего
 * варианта тут нет: загрузка и отказ — это `QueryState`, и разбираются они там.
 *
 * Компонент общий на все списки: одинаковые состояния должны и выглядеть
 * одинаково, иначе через полгода их будет три разных.
 */
export function ListEmpty({
  isFiltered,
  onReset,
  /** Что именно пусто, именительный: «сотрудников», «блюд». */
  what,
  /** Подсказка для по-настоящему пустого списка: как завести первую запись. */
  emptyHint,
  testId = 'list-empty',
}: {
  isFiltered: boolean;
  onReset?: () => void;
  what: string;
  emptyHint?: string;
  testId?: string;
}) {
  const { t } = useTranslation();

  if (isFiltered) {
    return (
      <EmptyState
        testId={`${testId}-nothing-found`}
        title={t('list.nothingFound')}
        description={t('list.nothingFoundHint')}
        action={
          onReset ? (
            <Button size="small" onClick={onReset} data-testid={`${testId}-reset`}>
              {t('list.resetFilters')}
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <EmptyState
      testId={`${testId}-none`}
      title={t('list.empty', { what })}
      description={emptyHint}
    />
  );
}
