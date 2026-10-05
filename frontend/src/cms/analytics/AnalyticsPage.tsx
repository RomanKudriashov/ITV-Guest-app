import { useEffect, useState } from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import RefreshIcon from '@mui/icons-material/Refresh';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';

import type { AnalyticsTab } from '@/api/analyticsTypes';
import { ExportButton } from './ExportButton';
import { FilterPanel } from './FilterPanel';
import { SalesTab } from './tabs/SalesTab';
import { OperationsTab } from './tabs/OperationsTab';
import { TrafficTab } from './tabs/TrafficTab';
import { ReviewsTab } from './tabs/ReviewsTab';
import { useAnalyticsFilters } from './useAnalyticsFilters';
import { useAnalyticsScope } from './useAnalyticsScope';

const TABS: AnalyticsTab[] = ['sales', 'operations', 'traffic', 'reviews'];

/** Все запросы раздела — их и обновляет кнопка, по ним и время актуальности. */
const ANALYTICS_KEY = ['cms', 'analytics'] as const;

/**
 * `/cms/analytics` — the hotel analytics dashboard.
 *
 * ONE `useAnalyticsFilters` controller owns the whole slice (period, compare,
 * dimension filters, drill-downs); every tab and every query reads its params
 * from that single source, so a preset flip or a filter change fans out to the
 * whole page at once.
 */
export function AnalyticsPage() {
  const { t, i18n } = useTranslation();
  const controller = useAnalyticsFilters();
  const scope = useAnalyticsScope();
  const [tab, setTab] = useState<AnalyticsTab>('sales');
  /*
    ВРЕМЯ АКТУАЛЬНОСТИ И «ОБНОВИТЬ» (партия 31, INV-05 QA). Открытая аналитика
    стояла как была, пока страницу не перезагрузят, и не говорила, на какой
    момент её цифры. Время — по самому свежему ответу раздела.
  */
  const queryClient = useQueryClient();
  const fetching = useIsFetching({ queryKey: ANALYTICS_KEY });
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  useEffect(() => {
    if (fetching) return;
    const times = queryClient
      .getQueryCache()
      .findAll({ queryKey: ANALYTICS_KEY })
      .map((query) => query.state.dataUpdatedAt)
      .filter(Boolean);
    if (times.length) setUpdatedAt(Math.max(...times));
  }, [fetching, queryClient]);

  return (
    <Box sx={{ p: 3 }} data-testid="cms-analytics">
      <Stack spacing={2}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1}
          alignItems={{ xs: 'flex-start', md: 'center' }}
          justifyContent="space-between"
        >
          <Stack>
            <Typography variant="h5" data-testid="cms-page-title">{t('analytics.title')}</Typography>
            <Typography variant="body2" color="text.secondary">
              {t('analytics.subtitle')}
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center">
            {updatedAt ? (
              <Typography variant="caption" color="text.secondary" data-testid="analytics-updated-at">
                {t('analytics.updatedAt', {
                  time: new Date(updatedAt).toLocaleTimeString(i18n.resolvedLanguage ?? 'ru', {
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                })}
              </Typography>
            ) : null}
            <Button
              size="small"
              startIcon={<RefreshIcon />}
              disabled={fetching > 0}
              onClick={() => void queryClient.invalidateQueries({ queryKey: ANALYTICS_KEY })}
              data-testid="analytics-refresh"
            >
              {t('analytics.refresh')}
            </Button>
            {/* Export always carries the CURRENT slice. */}
            <ExportButton params={controller.toQuery()} />
          </Stack>
        </Stack>

        <FilterPanel controller={controller} scope={scope.data} />

        <Tabs
          value={tab}
          onChange={(_e, value: AnalyticsTab) => setTab(value)}
          sx={{ borderBottom: 1, borderColor: 'divider' }}
          variant="scrollable"
          scrollButtons="auto"
        >
          {TABS.map((key) => (
            <Tab
              key={key}
              value={key}
              label={t(`analytics.tabs.${key}`)}
              data-testid={`analytics-tab-${key}`}
            />
          ))}
        </Tabs>

        {tab === 'sales' ? <SalesTab controller={controller} /> : null}
        {tab === 'operations' ? <OperationsTab controller={controller} /> : null}
        {tab === 'traffic' ? <TrafficTab controller={controller} /> : null}
        {tab === 'reviews' ? <ReviewsTab controller={controller} /> : null}
      </Stack>
    </Box>
  );
}
