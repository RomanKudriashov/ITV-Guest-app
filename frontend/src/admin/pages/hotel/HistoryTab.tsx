import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { QueryState } from '@/components/QueryState';
import { ink, secondaryButtonSx, typo } from '../../adminTokens';
import { getHotelHistory, type HistoryPage } from '../../adminClient';
import { Empty, FilterBar, Panel, type Facet } from '../hotels/hotelsUi';
import { JournalRow, PERIODS } from '../journalUi';

/**
 * «ИСТОРИЯ» ОТЕЛЯ (партия 62-D): все правки из Control — профиль, модули,
 * подключения, группа, отключение, админы, управление номером, входы
 * поддержки. Фильтры кто / что (раздел и поле) / период и текст — в адресе,
 * считает сервер; листание курсором — «Показать ещё», без потолка.
 */

const KEYS = ['who', 'what', 'period', 'search'] as const;

export function HistoryTab({ hotelId }: { hotelId: string }) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const filters = Object.fromEntries(KEYS.map((key) => [key, params.get(key) ?? '']));
  const history = useInfiniteQuery({
    queryKey: ['admin', 'history', hotelId, filters],
    queryFn: ({ pageParam }) => getHotelHistory(hotelId, { ...filters, cursor: pageParam ?? '' }),
    initialPageParam: '' as string,
    getNextPageParam: (last: HistoryPage) => last.next_cursor ?? undefined,
    placeholderData: keepPreviousData,
  });

  return (
    <Panel title={t('admin.history.title')}>
      <QueryState query={history} what={t('admin.history.what')}>
        {(data) => {
          const first = data.pages[0];
          const items = data.pages.flatMap((page) => page.items);
          const sectionLabel = (value: string) => {
            const [section, field] = value.split(':');
            const head = t(`admin.history.section.${section}`, { defaultValue: t('admin.hotels.filter.unknownValue') });
            return field ? `${head} · ${t(`admin.profile.field.${field}`, { defaultValue: t('admin.hotels.filter.unknownValue') })}` : head;
          };
          const whoLabel = (value: string, label = '') =>
            value === 'system' ? t('admin.journal.system') : label || t('admin.hotels.filter.unknownValue');
          const facets: Facet[] = [
            {
              key: 'who',
              label: t('admin.history.who'),
              options: first.facets.who.map((f) => ({ value: f.value, label: whoLabel(f.value, f.label), count: f.count })),
              describe: (value) => whoLabel(value),
            },
            {
              key: 'what',
              label: t('admin.history.whatFilter'),
              options: first.facets.what.map((f) => ({ value: f.value, label: sectionLabel(f.value), count: f.count })),
              describe: sectionLabel,
            },
            { key: 'period', label: t('admin.history.period'), options: PERIODS.map((p) => ({ value: p, label: t(`admin.history.periods.${p}`) })) },
          ];
          return (
            <Box data-testid="admin-history">
              <FilterBar facets={facets} placeholder={t('admin.history.search')} />
              <Typography sx={{ ...typo.caption, color: ink.mid, mb: 1 }} data-testid="admin-history-count">
                {t('admin.history.count', { shown: items.length, total: first.total })}
              </Typography>
              {items.length ? (
                items.map((entry) => <JournalRow key={entry.id} entry={entry} testId="admin-history-row" />)
              ) : (
                <Empty title={t('admin.history.emptyTitle')}>{t('admin.history.emptyBody')}</Empty>
              )}
              {history.hasNextPage ? (
                <Button
                  sx={{ ...secondaryButtonSx, mt: 2 }}
                  onClick={() => void history.fetchNextPage()}
                  disabled={history.isFetchingNextPage}
                  data-testid="admin-history-more"
                >
                  {t('admin.history.more')}
                </Button>
              ) : null}
            </Box>
          );
        }}
      </QueryState>
    </Panel>
  );
}
