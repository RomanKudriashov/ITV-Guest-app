import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';

import { fetchReviews } from '@/api/analytics';
import { queryKeys } from '@/api/queryKeys';
import { EmptyState } from '@/components/EmptyState';
import { LineChart, type LinePoint } from '../charts/InlineCharts';
import { StatTile } from '../StatTile';
import { useAnalyticsLanguage, useMetricFormatters } from '../format';
import type { UseAnalyticsFilters } from '../useAnalyticsFilters';

export function ReviewsTab({ controller }: { controller: UseAnalyticsFilters }) {
  const { t } = useTranslation();
  const fmt = useMetricFormatters();
  const language = useAnalyticsLanguage();

  const params = controller.toQuery();
  const slice = controller.sliceKey();
  const query = useQuery({
    queryKey: queryKeys.analyticsReviews(slice),
    queryFn: () => fetchReviews(params),
    retry: 1,
  });

  if (query.isError) {
    return <Alert severity="error">{t('analytics.errors.reviews')}</Alert>;
  }

  const data = query.data;
  const trendPoints: LinePoint[] = (data?.trend ?? []).map((point) => ({
    label: formatDay(point.bucket, language),
    value: point.avg_rating,
  }));
  const byPoint = data?.by_point ?? [];

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
          label={t('analytics.metrics.avg_rating')}
          value={data ? fmt.rating(data.avg_rating) : undefined}
          loading={query.isLoading}
        />
        <StatTile
          label={t('analytics.reviews.lowRate')}
          value={data ? fmt.percent(data.low_review_rate) : undefined}
          loading={query.isLoading}
        />
        <StatTile
          label={t('analytics.reviews.count')}
          value={data ? fmt.count(data.reviews_count) : undefined}
          loading={query.isLoading}
        />
      </Box>

      <Card variant="outlined" sx={{ borderColor: 'divider' }}>
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
          <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
            {t('analytics.reviews.trend')}
          </Typography>
          {query.isLoading ? (
            <Skeleton variant="rounded" height={180} />
          ) : trendPoints.length === 0 ? (
            <EmptyState title={t('analytics.empty.reviews')} />
          ) : (
            <LineChart
              points={trendPoints}
              formatValue={(v) => fmt.rating(v)}
              ariaLabel={t('analytics.reviews.trend')}
            />
          )}
        </CardContent>
      </Card>

      <Card variant="outlined" sx={{ borderColor: 'divider' }}>
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
          <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
            {t('analytics.reviews.byPoint')}
          </Typography>
          {query.isLoading ? (
            <Skeleton variant="rounded" height={140} />
          ) : byPoint.length === 0 ? (
            <EmptyState title={t('analytics.empty.reviews')} />
          ) : (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" data-testid="analytics-reviews-table">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('analytics.reviews.columns.point')}</TableCell>
                    <TableCell align="right">{t('analytics.reviews.columns.reviews')}</TableCell>
                    <TableCell align="right">{t('analytics.reviews.columns.share')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {byPoint.map((row) => (
                    <TableRow key={row.key} hover data-testid={`analytics-reviews-row-${row.key}`}>
                      <TableCell>{row.label}</TableCell>
                      <TableCell align="right">{fmt.count(row.orders)}</TableCell>
                      <TableCell align="right">{fmt.percent(row.share)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
        </CardContent>
      </Card>
    </Stack>
  );
}

function formatDay(bucket: string, language: string): string {
  const date = new Date(bucket);
  if (Number.isNaN(date.getTime())) return bucket;
  return new Intl.DateTimeFormat(language, { day: '2-digit', month: 'short' }).format(date);
}
