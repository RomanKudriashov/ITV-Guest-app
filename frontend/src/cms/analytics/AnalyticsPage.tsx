import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
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

/**
 * `/cms/analytics` — the hotel analytics dashboard.
 *
 * ONE `useAnalyticsFilters` controller owns the whole slice (period, compare,
 * dimension filters, drill-downs); every tab and every query reads its params
 * from that single source, so a preset flip or a filter change fans out to the
 * whole page at once.
 */
export function AnalyticsPage() {
  const { t } = useTranslation();
  const controller = useAnalyticsFilters();
  const scope = useAnalyticsScope();
  const [tab, setTab] = useState<AnalyticsTab>('sales');

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
            <Typography variant="h5">{t('analytics.title')}</Typography>
            <Typography variant="body2" color="text.secondary">
              {t('analytics.subtitle')}
            </Typography>
          </Stack>
          {/* Export always carries the CURRENT slice. */}
          <ExportButton params={controller.toQuery()} />
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
