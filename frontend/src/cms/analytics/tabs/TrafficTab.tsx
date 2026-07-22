import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { fetchTraffic } from '@/api/analytics';
import type { BreakdownRow } from '@/api/analyticsTypes';
import { queryKeys } from '@/api/queryKeys';
import { EmptyState } from '@/components/EmptyState';
import { Bar } from '../charts/InlineCharts';
import { StatTile } from '../StatTile';
import { useMetricFormatters } from '../format';
import type { UseAnalyticsFilters } from '../useAnalyticsFilters';

export function TrafficTab({ controller }: { controller: UseAnalyticsFilters }) {
  const { t } = useTranslation();
  const fmt = useMetricFormatters();

  const params = controller.toQuery();
  const slice = controller.sliceKey();
  const query = useQuery({
    queryKey: queryKeys.analyticsTraffic(slice),
    queryFn: () => fetchTraffic(params),
    retry: 1,
  });

  if (query.isError) {
    return <Alert severity="error">{t('analytics.errors.traffic')}</Alert>;
  }

  const data = query.data;

  return (
    <Stack spacing={2}>
      <Box
        sx={{
          display: 'grid',
          gap: 1.5,
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        }}
      >
        <StatTile
          label={t('analytics.metrics.sessions')}
          value={data ? fmt.count(data.sessions) : undefined}
          loading={query.isLoading}
        />
        <StatTile
          label={t('analytics.metrics.conversion')}
          value={data ? fmt.percent(data.conversion) : undefined}
          loading={query.isLoading}
        />
      </Box>

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        }}
      >
        <BreakdownBars
          title={t('analytics.dimensions.entry_method')}
          rows={data?.by_entry_method ?? []}
          loading={query.isLoading}
          labelKey="entry_method"
        />
        <BreakdownBars
          title={t('analytics.dimensions.device')}
          rows={data?.by_device ?? []}
          loading={query.isLoading}
          labelKey="device"
        />
        <BreakdownBars
          title={t('analytics.dimensions.language')}
          rows={data?.by_language ?? []}
          loading={query.isLoading}
          labelKey="language"
        />
      </Box>
    </Stack>
  );
}

function BreakdownBars({
  title,
  rows,
  loading,
  labelKey,
}: {
  title: string;
  rows: BreakdownRow[];
  loading: boolean;
  labelKey: 'entry_method' | 'device' | 'language';
}) {
  const { t } = useTranslation();
  const fmt = useMetricFormatters();
  const max = Math.max(...rows.map((r) => r.orders), 1);

  return (
    <Card variant="outlined" sx={{ borderColor: 'divider' }}>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
          {title}
        </Typography>
        {loading ? (
          <Skeleton variant="rounded" height={120} />
        ) : rows.length === 0 ? (
          <EmptyState title={t('analytics.empty.breakdown')} />
        ) : (
          <Stack spacing={1.25}>
            {rows.map((row) => (
              <Box key={row.key} data-testid={`analytics-traffic-${labelKey}-${row.key}`}>
                <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                  <Typography variant="body2">
                    {t(`analytics.values.${labelKey}.${row.key}`, { defaultValue: row.label })}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {fmt.count(row.orders)} · {fmt.percent(row.share)}
                  </Typography>
                </Stack>
                <Bar fraction={row.orders / max} />
              </Box>
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
