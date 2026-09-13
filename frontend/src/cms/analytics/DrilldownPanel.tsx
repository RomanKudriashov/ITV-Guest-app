import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Button from '@mui/material/Button';
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

/**
 * «ПОКАЗАТЬ ЭТИ ЗАКАЗЫ» — ПЕРЕНОС СРЕЗА В РАЗДЕЛ «ЗАКАЗЫ».
 *
 * Аналитика отвечает «сколько и на сколько», а дальше человек хочет увидеть
 * сами заявки: чем занималась кухня в тот день, какие из них отменили и
 * почему. Раньше это означало вручную повторить фильтры в другом разделе — и
 * получить другую выборку, потому что руками их повторяют неточно.
 *
 * Переносятся ровно те параметры, которые у обоих разделов значат одно:
 * период и заведение. Остальные разрезы аналитики (устройство, язык, способ
 * входа) в разделе заказов не живут, и подменять их на «примерно то же» хуже,
 * чем не переносить.
 *
 * ГРАНИЦЫ БЕРУТСЯ ИЗ ЭХА СЕРВЕРА, А НЕ ИЗ ПАРАМЕТРОВ ЭКРАНА.
 *
 * `date_from`/`date_to` заполнены только когда человек задал даты руками. На
 * пресете — а «неделя» стоит по умолчанию — экран шлёт `preset=week` и дат не
 * шлёт вовсе. Ссылка, собранная из параметров, теряла период МОЛЧА и в самом
 * частом случае: раздел открывался по всей истории, а человек был уверен, что
 * смотрит те же сутки, что и в аналитике.
 *
 * Разворачивать пресет в даты на клиенте нельзя: сутки считаются по часовому
 * поясу отеля, и второй экземпляр этого правила разошёлся бы с первым на
 * первом же отеле не в своём поясе. Сервер уже вернул разрешённые границы
 * (`summary.period`) — их и берём, а параметры остаются запасным путём.
 */
function ordersLink(params: AnalyticsQuery, period?: { from: string; to: string }): string {
  const query = new URLSearchParams();
  const since = period?.from || params.date_from;
  const until = period?.to || params.date_to;
  if (typeof since === 'string' && since) query.set('since', since);
  if (typeof until === 'string' && until) query.set('until', until);
  const point = (params as Record<string, unknown>).point_id;
  if (typeof point === 'string' && point) query.set('point', point);
  const suffix = query.toString();
  return `/cms/orders${suffix ? `?${suffix}` : ''}`;
}

export function DrilldownPanel({
  params,
  sliceKey,
  period,
  onClose,
}: {
  params: AnalyticsQuery;
  sliceKey: string;
  /** Разрешённые границы периода из ответа сводки — см. `ordersLink`. */
  period?: { from: string; to: string };
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
          <Stack direction="row" spacing={1} alignItems="center">
            {/*
              КНОПКА ЖДЁТ ПЕРИОД, А НЕ УВОДИТ БЕЗ НЕГО.

              Границы приходят со сводкой, а разбор заявок открывается раньше,
              чем она доедет. Кнопка, доступная в этот момент, уносила бы
              ПУСТОЙ период — то есть открывала раздел по всей истории, пока
              человек уверен, что смотрит свои сутки. Молча и только на
              медленном ответе: поймано прогоном под нагрузкой.

              Поэтому пока периода нет — кнопка неактивна. Это ровно тот
              случай, когда серая кнопка честна: она сработает через секунду,
              и ждать тут есть чего.
            */}
            <Button
              size="small"
              variant="outlined"
              href={period ? ordersLink(params, period) : undefined}
              disabled={!period}
              data-testid="analytics-to-orders"
            >
              {t('analytics.drilldown.toOrders')}
            </Button>
            <IconButton
              size="small"
              onClick={onClose}
              aria-label={t('common.close')}
              data-testid="analytics-drilldown-close"
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>
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
