import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';

import { fetchTimeseries } from '@/api/analytics';
import type { AnalyticsQuery, Granularity, TimeseriesPoint } from '@/api/analyticsTypes';
import { queryKeys } from '@/api/queryKeys';
import { EmptyState } from '@/components/EmptyState';
import { LineChart, type LinePoint } from './charts/InlineCharts';
import { useAnalyticsLanguage, useMetricFormatters } from './format';

const GRANULARITIES: Granularity[] = ['hour', 'day', 'week'];

type SeriesMetric = 'orders' | 'revenue_minor' | 'sessions';
const METRICS: SeriesMetric[] = ['orders', 'revenue_minor', 'sessions'];

export function TimeseriesPanel({
  params,
  sliceKey,
}: {
  params: AnalyticsQuery;
  sliceKey: string;
}) {
  const { t } = useTranslation();
  const fmt = useMetricFormatters();
  const language = useAnalyticsLanguage();
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [metric, setMetric] = useState<SeriesMetric>('orders');

  const query = { ...params, granularity };
  const timeseries = useQuery({
    queryKey: queryKeys.analyticsTimeseries(`${sliceKey}|${granularity}`),
    queryFn: () => fetchTimeseries(query),
    retry: 1,
  });

  const points = timeseries.data?.points ?? [];
  const formatValue = (value: number) =>
    metric === 'revenue_minor' ? fmt.money(value) : fmt.count(value);

  const linePoints: LinePoint[] = points.map((p: TimeseriesPoint) => ({
    label: formatBucket(p.bucket, granularity, language),
    value: (p[metric] as number | undefined) ?? 0,
  }));

  return (
    <Card variant="outlined" sx={{ borderColor: 'divider' }}>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          alignItems={{ xs: 'stretch', sm: 'center' }}
          justifyContent="space-between"
          sx={{ mb: 1.5 }}
        >
          <Typography variant="subtitle1">{t('analytics.timeseries.title')}</Typography>
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
            <TextField
              select
              size="small"
              label={t('analytics.timeseries.metric')}
              value={metric}
              onChange={(e) => setMetric(e.target.value as SeriesMetric)}
              sx={{ minWidth: 150 }}
            >
              {METRICS.map((m) => (
                <MenuItem key={m} value={m}>
                  {t(`analytics.series.${m}`)}
                </MenuItem>
              ))}
            </TextField>
            <ToggleButtonGroup
              size="small"
              exclusive
              color="primary"
              value={granularity}
              onChange={(_e, next) => {
                if (next) setGranularity(next as Granularity);
              }}
              aria-label={t('analytics.timeseries.granularity')}
            >
              {GRANULARITIES.map((g) => (
                <ToggleButton key={g} value={g} data-testid={`analytics-granularity-${g}`}>
                  {t(`analytics.granularity.${g}`)}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Stack>
        </Stack>

        <Box data-testid="analytics-timeseries">
          {timeseries.isLoading ? (
            <Skeleton variant="rounded" height={180} />
          ) : timeseries.isError ? (
            <Alert severity="error">{t('analytics.errors.timeseries')}</Alert>
          ) : linePoints.length === 0 ? (
            <EmptyState testId="analytics-timeseries-empty" title={t('analytics.empty.timeseries')} />
          ) : (
            <LineChart
              points={linePoints}
              formatValue={formatValue}
              ariaLabel={t('analytics.timeseries.title')}
            />
          )}
        </Box>
      </CardContent>
    </Card>
  );
}

function formatBucket(bucket: string, granularity: Granularity, language: string): string {
  const date = new Date(bucket);
  if (Number.isNaN(date.getTime())) return bucket;
  if (granularity === 'hour') {
    return new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }).format(date);
  }
  return new Intl.DateTimeFormat(language, { day: '2-digit', month: 'short' }).format(date);
}
