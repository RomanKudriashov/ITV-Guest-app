import type { ReactNode } from 'react';
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
  /*
    Чем отсеяно: только строкой поиска — «по запросу ничего не найдено» и
    «сбросить поиск»; фильтрами (или поиском вместе с ними) — «снять фильтры».
    Кнопка должна называть то, что человек сам ввёл.
  */
  narrowedBy = 'filters',
  /** Своя фраза настоящей пустоты («Пока нет сотрудников») — иначе общая. */
  emptyTitle,
  /** Действие для по-настоящему пустого списка — «Добавить сотрудника». */
  emptyAction,
  /** Что именно пусто, именительный: «сотрудников», «блюд». */
  what,
  /** Подсказка для по-настоящему пустого списка: как завести первую запись. */
  emptyHint,
  /*
    ОДИН testid на пустоту во всём приложении — тот же, что у `QueryState`.

    Свои `list-empty-none` и `list-empty-nothing-found` я тут уже успел
    завести, и это было ровно то размножение, которого мы избегаем: два
    названия одного состояния, и половина проверок ищет не то. Различаются
    состояния ТЕКСТОМ — тем же, что читает человек.
  */
  testId = 'state-empty',
}: {
  isFiltered: boolean;
  onReset?: () => void;
  narrowedBy?: 'search' | 'filters';
  emptyTitle?: string;
  emptyAction?: ReactNode;
  what: string;
  emptyHint?: string;
  testId?: string;
}) {
  const { t } = useTranslation();

  if (isFiltered) {
    const bySearch = narrowedBy === 'search';
    return (
      <EmptyState
        testId={testId}
        title={t(bySearch ? 'list.nothingFoundSearch' : 'list.nothingFound')}
        description={t(bySearch ? 'list.nothingFoundSearchHint' : 'list.nothingFoundHint')}
        action={
          onReset ? (
            <Button size="small" onClick={onReset} data-testid="list-reset-filters">
              {t(bySearch ? 'list.resetSearch' : 'list.resetFilters')}
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <EmptyState
      testId={testId}
      title={emptyTitle ?? t('list.empty', { what })}
      description={emptyHint}
      action={emptyAction}
    />
  );
}
