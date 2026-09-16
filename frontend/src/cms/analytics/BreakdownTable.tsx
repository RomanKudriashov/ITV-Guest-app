import { useTranslation } from 'react-i18next';

import type { Dimension } from '@/api/analyticsTypes';
import { dimensionValueLabel } from './dimensions';
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
  dimension,
  rows,
  isLoading,
  isError,
  sort,
  order,
  onSort,
  onDrill,
  canDrill,
}: {
  /** По какому измерению разбивка — от него зависит подпись значения. */
  dimension: Dimension;
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

  /*
    РАЗРЕЗ ПО КАТЕГОРИИ НОМЕРА ЧИТАЕТСЯ ТОЛЬКО В СРАВНЕНИИ.

    «Люкс принёс 400 тысяч, стандарт 900» — не ответ: люксов восемь, а
    стандартов девяносто. Поэтому здесь добавляются две колонки — сколько
    номеров в категории СЕЙЧАС и сколько заказов на номер, — и фраза, которая
    прямо называет отношение к самой слабой категории.
  */
  const isRoomCategory = dimension === 'room_category';
  const leader = isRoomCategory
    ? rows.reduce<BreakdownRow | null>(
        (best, row) =>
          row.ratio_to_base && (!best || (best.ratio_to_base ?? 0) < row.ratio_to_base) ? row : best,
        null,
      )
    : null;
  const uncategorised = isRoomCategory ? rows.find((row) => !row.key) : undefined;

  return (
    <Box sx={{ overflowX: 'auto' }}>
      {leader && leader.ratio_to_base && leader.ratio_to_base > 1 ? (
        <Alert severity="info" sx={{ mb: 1 }} data-testid="analytics-category-compare">
          {t('analytics.roomCategory.compare', {
            leader: dimensionValueLabel(t, dimension, leader.key, leader.label),
            base: leader.base_label,
            ratio: leader.ratio_to_base.toLocaleString(undefined, { maximumFractionDigits: 1 }),
          })}
        </Alert>
      ) : null}

      {/*
        «Без категории» НЕ прячется: иначе сумма долей перестанет сходиться с
        итогом. И она честно объясняется — под ней лежат две разные вещи.
      */}
      {uncategorised ? (
        <Alert severity="warning" sx={{ mb: 1 }} data-testid="analytics-category-unknown">
          {t('analytics.roomCategory.unknown', { count: uncategorised.orders })}
        </Alert>
      ) : null}

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
            {isRoomCategory ? (
              <>
                <TableCell align="right">{t('analytics.roomCategory.rooms')}</TableCell>
                <TableCell align="right">{t('analytics.roomCategory.perRoom')}</TableCell>
              </>
            ) : null}
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
                {/*
                  Подпись, а не ключ. Сервер подставляет `label` только там, где
                  имя лежит в базе — точки, локации, позиции, категории. Для
                  реестровых измерений (тип, способ входа, устройство, язык)
                  `label` равен коду, и в таблице читалось `product`,
                  `service_request`, `slot`. Имя для них знает интерфейс.
                */}
                <Typography variant="body2" fontWeight={500}>
                  {dimensionValueLabel(t, dimension, row.key, row.label)}
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
              {isRoomCategory ? (
                <>
                  <TableCell align="right" data-testid={`analytics-category-rooms-${row.key}`}>
                    {row.rooms ? fmt.count(row.rooms) : '—'}
                  </TableCell>
                  <TableCell align="right" data-testid={`analytics-category-per-room-${row.key}`}>
                    {/* Прочерк, а не ноль: «нет номеров под этой категорией»
                        и «на номер ноль заказов» — разные утверждения. */}
                    {row.orders_per_room ? row.orders_per_room.toFixed(2) : '—'}
                  </TableCell>
                </>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}
