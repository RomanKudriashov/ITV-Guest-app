import { useTranslation } from 'react-i18next';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import Typography from '@mui/material/Typography';

import type { BreakdownRow, SortOrder } from '@/api/analyticsTypes';
import { EmptyState } from '@/components/EmptyState';
import { Bar } from './charts/InlineCharts';
import { useMetricFormatters } from './format';

/** Column ids double as the `sort=` param value sent to the backend. */
type ColumnId = 'label' | 'orders' | 'quantity' | 'revenue_minor' | 'share';

interface Column {
  id: ColumnId;
  align: 'left' | 'right';
  numeric: boolean;
}

const COLUMNS: Column[] = [
  { id: 'label', align: 'left', numeric: false },
  { id: 'orders', align: 'right', numeric: true },
  { id: 'quantity', align: 'right', numeric: true },
  { id: 'revenue_minor', align: 'right', numeric: true },
  { id: 'share', align: 'right', numeric: true },
];

export function BreakdownTable({
  rows,
  isLoading,
  isError,
  sort,
  order,
  onSort,
  onDrill,
  canDrill,
}: {
  rows: BreakdownRow[];
  isLoading: boolean;
  isError: boolean;
  sort: string;
  order: SortOrder;
  onSort: (column: string) => void;
  onDrill: (row: BreakdownRow) => void;
  canDrill: boolean;
}) {
  const { t } = useTranslation();
  const fmt = useMetricFormatters();

  if (isLoading) {
    return (
      <Box sx={{ p: 1 }}>
        {[0, 1, 2, 3].map((k) => (
          <Skeleton key={k} variant="rounded" height={40} sx={{ mb: 1 }} />
        ))}
      </Box>
    );
  }

  if (isError) {
    return <Alert severity="error">{t('analytics.errors.breakdown')}</Alert>;
  }

  if (rows.length === 0) {
    return <EmptyState testId="analytics-breakdown-empty" title={t('analytics.empty.breakdown')} />;
  }

  const maxShare = Math.max(...rows.map((r) => r.share), 0.0001);
  const hasQuantity = rows.some((r) => typeof r.quantity === 'number');

  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small" data-testid="analytics-breakdown-table">
        <TableHead>
          <TableRow>
            {COLUMNS.filter((c) => c.id !== 'quantity' || hasQuantity).map((column) => (
              <TableCell key={column.id} align={column.align} sortDirection={sort === column.id ? order : false}>
                <TableSortLabel
                  active={sort === column.id}
                  direction={sort === column.id ? order : 'desc'}
                  onClick={() => onSort(column.id)}
                  data-testid={`analytics-breakdown-sort-${column.id}`}
                >
                  {t(`analytics.columns.${column.id}`)}
                </TableSortLabel>
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.key}
              hover
              onClick={canDrill ? () => onDrill(row) : undefined}
              sx={{ cursor: canDrill ? 'pointer' : 'default' }}
              data-testid={`analytics-breakdown-row-${row.key}`}
            >
              <TableCell>
                <Typography variant="body2" fontWeight={500}>
                  {row.label}
                </Typography>
              </TableCell>
              <TableCell align="right">{fmt.count(row.orders)}</TableCell>
              {hasQuantity ? (
                <TableCell align="right">
                  {typeof row.quantity === 'number' ? fmt.count(row.quantity) : '—'}
                </TableCell>
              ) : null}
              <TableCell align="right">{fmt.money(row.revenue_minor)}</TableCell>
              <TableCell align="right">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'flex-end' }}>
                  <Box sx={{ width: 64 }}>
                    <Bar fraction={row.share / maxShare} />
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ minWidth: 40, textAlign: 'end' }}>
                    {fmt.percent(row.share)}
                  </Typography>
                </Box>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}
