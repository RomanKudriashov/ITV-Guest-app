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

import { fetchOperations } from '@/api/analytics';
import { queryKeys } from '@/api/queryKeys';
import { EmptyState } from '@/components/EmptyState';
import { StatTile } from '../StatTile';
import { useMetricFormatters } from '../format';
import type { UseAnalyticsFilters } from '../useAnalyticsFilters';

export function OperationsTab({ controller }: { controller: UseAnalyticsFilters }) {
  const { t } = useTranslation();
  const fmt = useMetricFormatters();

  const params = controller.toQuery({ group: 'point' });
  const slice = controller.sliceKey({ group: 'point' });
  const query = useQuery({
    queryKey: queryKeys.analyticsOperations(slice),
    queryFn: () => fetchOperations(params),
    retry: 1,
  });

  if (query.isError) {
    return <Alert severity="error">{t('analytics.errors.operations')}</Alert>;
  }

  const data = query.data;
  const rows = data?.rows ?? [];

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
          label={t('analytics.operations.avgReaction')}
          value={data ? fmt.duration(data.avg_reaction_seconds) : undefined}
          loading={query.isLoading}
        />
        <StatTile
          label={t('analytics.operations.avgFulfil')}
          value={data ? fmt.duration(data.avg_fulfil_seconds) : undefined}
          loading={query.isLoading}
        />
        <StatTile
          label={t('analytics.operations.cancelRate')}
          value={data ? fmt.percent(data.cancel_rate) : undefined}
          loading={query.isLoading}
        />
        <StatTile
          label={t('analytics.operations.offHours')}
          value={data ? fmt.percent(data.off_hours_rate) : undefined}
          loading={query.isLoading}
        />
        <StatTile
          label={t('analytics.operations.escalations')}
          value={data ? fmt.count(data.escalations) : undefined}
          loading={query.isLoading}
        />
      </Box>

      <Card variant="outlined" sx={{ borderColor: 'divider' }}>
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
          <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
            {t('analytics.operations.byPoint')}
          </Typography>
          {query.isLoading ? (
            <Skeleton variant="rounded" height={160} />
          ) : rows.length === 0 ? (
            <EmptyState testId="analytics-operations-empty" title={t('analytics.empty.operations')} />
          ) : (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" data-testid="analytics-operations-table">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('analytics.operations.columns.point')}</TableCell>
                    <TableCell align="right">{t('analytics.operations.columns.orders')}</TableCell>
                    <TableCell align="right">{t('analytics.operations.columns.reaction')}</TableCell>
                    <TableCell align="right">{t('analytics.operations.columns.fulfil')}</TableCell>
                    <TableCell align="right">{t('analytics.operations.columns.cancelRate')}</TableCell>
                    <TableCell align="right">{t('analytics.operations.columns.escalations')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.key} hover data-testid={`analytics-operations-row-${row.key}`}>
                      <TableCell>{row.label}</TableCell>
                      <TableCell align="right">{fmt.count(row.orders)}</TableCell>
                      <TableCell align="right">{fmt.duration(row.avg_reaction_seconds)}</TableCell>
                      <TableCell align="right">{fmt.duration(row.avg_fulfil_seconds)}</TableCell>
                      <TableCell align="right">{fmt.percent(row.cancel_rate)}</TableCell>
                      <TableCell align="right">{fmt.count(row.escalations)}</TableCell>
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
