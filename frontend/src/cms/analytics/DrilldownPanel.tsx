import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';

import { fetchDrilldown } from '@/api/analytics';
import type { AnalyticsQuery, SortOrder } from '@/api/analyticsTypes';
import { queryKeys } from '@/api/queryKeys';
import { EmptyState } from '@/components/EmptyState';
import { statusColorPath } from '@/tracker/statusColor';
import { useAnalyticsLanguage, useMetricFormatters } from './format';

type ColumnId = 'number' | 'type' | 'point' | 'status' | 'total_minor' | 'created_at' | 'room' | 'rating';

const COLUMNS: { id: ColumnId; align: 'left' | 'right'; sortable: boolean }[] = [
  { id: 'number', align: 'left', sortable: true },
  { id: 'type', align: 'left', sortable: true },
  { id: 'point', align: 'left', sortable: true },
  { id: 'status', align: 'left', sortable: true },
  { id: 'total_minor', align: 'right', sortable: true },
  { id: 'created_at', align: 'left', sortable: true },
  { id: 'room', align: 'left', sortable: false },
  { id: 'rating', align: 'right', sortable: true },
];

export function DrilldownPanel({
  params,
  sliceKey,
  onClose,
}: {
  params: AnalyticsQuery;
  sliceKey: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const fmt = useMetricFormatters();
  const language = useAnalyticsLanguage();
  const [sort, setSort] = useState<ColumnId>('created_at');
  const [order, setOrder] = useState<SortOrder>('desc');

  const query = { ...params, sort, order };
  const drilldown = useQuery({
    queryKey: queryKeys.analyticsDrilldown(`${sliceKey}|${sort}|${order}`),
    queryFn: () => fetchDrilldown(query),
    retry: 1,
  });

  const onSort = (column: ColumnId) => {
    if (sort === column) setOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(column);
      setOrder('desc');
    }
  };

  const dateFormatter = new Intl.DateTimeFormat(language, {
    dateStyle: 'short',
    timeStyle: 'short',
  });

  const orders = drilldown.data?.orders ?? [];

  return (
    <Card variant="outlined" sx={{ borderColor: 'divider' }} data-testid="analytics-drilldown">
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Stack>
            <Typography variant="subtitle1">{t('analytics.drilldown.title')}</Typography>
            <Typography variant="caption" color="text.secondary">
              {t('analytics.drilldown.count', { count: drilldown.data?.total ?? orders.length })}
            </Typography>
          </Stack>
          <IconButton
            size="small"
            onClick={onClose}
            aria-label={t('common.close')}
            data-testid="analytics-drilldown-close"
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>

        {drilldown.isLoading ? (
          <Box>
            {[0, 1, 2].map((k) => (
              <Skeleton key={k} variant="rounded" height={40} sx={{ mb: 1 }} />
            ))}
          </Box>
        ) : drilldown.isError ? (
          <Alert severity="error">{t('analytics.errors.drilldown')}</Alert>
        ) : orders.length === 0 ? (
          <EmptyState testId="analytics-drilldown-empty" title={t('analytics.empty.drilldown')} />
        ) : (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  {COLUMNS.map((column) => (
                    <TableCell key={column.id} align={column.align}>
                      {column.sortable ? (
                        <TableSortLabel
                          active={sort === column.id}
                          direction={sort === column.id ? order : 'desc'}
                          onClick={() => onSort(column.id)}
                        >
                          {t(`analytics.drilldown.columns.${column.id}`)}
                        </TableSortLabel>
                      ) : (
                        t(`analytics.drilldown.columns.${column.id}`)
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {orders.map((row) => (
                  <TableRow key={row.id} hover data-testid={`analytics-drilldown-row-${row.id}`}>
                    <TableCell>
                      <Typography variant="body2" fontWeight={500}>
                        {row.number}
                      </Typography>
                    </TableCell>
                    <TableCell>{t(`analytics.values.type.${row.type}`, { defaultValue: row.type })}</TableCell>
                    <TableCell>{row.point}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={row.status}
                        sx={{ color: statusColorPath(row.status), borderColor: statusColorPath(row.status) }}
                      />
                    </TableCell>
                    <TableCell align="right">{fmt.money(row.total_minor)}</TableCell>
                    <TableCell>{dateFormatter.format(new Date(row.created_at))}</TableCell>
                    <TableCell>{row.room ?? '—'}</TableCell>
                    <TableCell align="right">
                      {row.rating === null ? '—' : fmt.rating(row.rating)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
