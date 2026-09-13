import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { QueryState } from '@/components/QueryState';
import { ListEmpty } from '@/kit/list/ListEmpty';
import { useListQuery } from '@/kit/list/useListQuery';
import { fetchOrders, type OrdersPage as OrdersPageBody } from './api';
import { OrderCardDetail } from './OrderCardDetail';
import { OrdersNumbers } from './OrdersNumbers';

const DEFAULTS = {
  point: '',
  since: '',
  until: '',
  status: '',
  order_type: '',
  room: '',
  search: '',
};

/**
 * РАЗДЕЛ «ЗАКАЗЫ»: что происходило в отеле.
 *
 * Отличается от истории доски вопросом, на который отвечает. История — рабочий
 * экран одного заведения: повар смотрит свою кухню. Здесь смотрят по всем
 * заведениям сразу — когда разбирают жалобу или ищут конкретную заявку.
 *
 * ГЛУБОКИХ СРЕЗОВ ЗДЕСЬ НЕТ. Они в «Аналитике», и второй их экземпляр
 * разошёлся бы с первым на первой же правке. Здесь — список, фильтры и четыре
 * числа по текущей выборке.
 *
 * Состояние живёт В АДРЕСЕ (`useListQuery`), как в остальных списках: ссылку с
 * фильтром можно послать коллеге, и F5 не сбрасывает работу.
 */
export function OrdersPage() {
  const { t } = useTranslation();
  const { params, patch, reset, isFiltered } = useListQuery(DEFAULTS);
  // Курсор НЕ в адресе: это не фильтр, а место в листании. В ссылке он
  // означал бы «открой мне вторую страницу выборки, которой у тебя нет».
  const [pages, setPages] = useState<OrdersPageBody[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['cms', 'orders', params],
    queryFn: async () => {
      const body = await fetchOrders(params);
      // Новый фильтр — новое листание: показывать догруженное от прошлой
      // выборки значило бы смешать два ответа.
      setPages([body]);
      setCursor(body.next_cursor);
      return body;
    },
  });

  const loadMore = async () => {
    if (!cursor) return;
    const body = await fetchOrders(params, cursor);
    setPages((previous) => [...previous, body]);
    setCursor(body.next_cursor);
  };

  const rows = pages.flatMap((page) => page.orders);
  const venues = query.data?.points ?? [];

  return (
    <Stack spacing={2} data-testid="cms-orders">
      <Typography variant="h5" data-testid="cms-page-title">
        {t('orders.title')}
      </Typography>

      <QueryState query={query} what={t('orders.what')}>
        {(body) => (
          <Stack spacing={2}>
            <OrdersNumbers summary={body.summary} />

            <Card variant="outlined">
              <CardContent>
                <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                  <TextField
                    select
                    size="small"
                    label={t('orders.filters.venue')}
                    value={params.point}
                    onChange={(event) => patch({ point: event.target.value })}
                    sx={{ minWidth: 180 }}
                    // Метка — на ВИДИМУЮ часть селекта: `inputProps` у MUI
                    // садится на скрытый нативный input, по которому не
                    // кликнуть. Эти грабли у нас уже описаны в `BoardFilters`.
                    SelectProps={{
                      SelectDisplayProps: {
                        'data-testid': 'orders-filter-venue',
                      } as never,
                    }}
                  >
                    <MenuItem value="">{t('orders.filters.allVenues')}</MenuItem>
                    {venues.map((venue) => (
                      <MenuItem key={venue.id} value={venue.id}>
                        {venue.title}
                      </MenuItem>
                    ))}
                  </TextField>

                  <TextField
                    type="date"
                    size="small"
                    label={t('orders.filters.since')}
                    value={params.since}
                    onChange={(event) => patch({ since: event.target.value })}
                    InputLabelProps={{ shrink: true }}
                    inputProps={{ 'data-testid': 'orders-filter-since' }}
                  />
                  <TextField
                    type="date"
                    size="small"
                    label={t('orders.filters.until')}
                    value={params.until}
                    onChange={(event) => patch({ until: event.target.value })}
                    InputLabelProps={{ shrink: true }}
                    inputProps={{ 'data-testid': 'orders-filter-until' }}
                  />
                  <TextField
                    size="small"
                    label={t('orders.filters.room')}
                    value={params.room}
                    onChange={(event) => patch({ room: event.target.value })}
                    sx={{ width: 120 }}
                    inputProps={{ 'data-testid': 'orders-filter-room' }}
                  />
                  <TextField
                    size="small"
                    label={t('orders.filters.search')}
                    value={params.search}
                    onChange={(event) => patch({ search: event.target.value })}
                    sx={{ minWidth: 160 }}
                    inputProps={{ 'data-testid': 'orders-filter-search' }}
                  />
                  {isFiltered ? (
                    <Button onClick={reset} data-testid="orders-filter-reset">
                      {t('orders.filters.reset')}
                    </Button>
                  ) : null}
                </Stack>
              </CardContent>
            </Card>

            {rows.length ? (
              <Stack spacing={1} data-testid="orders-list">
                {rows.map((order) => (
                  <Card
                    key={order.id}
                    variant="outlined"
                    data-testid={`orders-row-${order.number}`}
                    onClick={() => setOpenId(order.id === openId ? null : order.id)}
                    sx={{ cursor: 'pointer' }}
                  >
                    <CardContent sx={{ py: 1.25 }}>
                      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
                        <Typography variant="subtitle2">№{order.number}</Typography>
                        <Chip size="small" label={order.status.title} />
                        <Typography variant="body2" color="text.secondary">
                          {order.execution_point.title}
                        </Typography>
                        {order.room ? (
                          <Typography variant="body2" color="text.secondary">
                            {t('orders.row.room', { room: order.room })}
                          </Typography>
                        ) : null}
                        <Box sx={{ flexGrow: 1 }} />
                        {order.cancel_reason_title ? (
                          <Chip
                            size="small"
                            color="warning"
                            variant="outlined"
                            label={order.cancel_reason_title}
                            data-testid={`orders-row-reason-${order.number}`}
                          />
                        ) : null}
                      </Stack>
                      {openId === order.id ? <OrderCardDetail order={order} /> : null}
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            ) : (
              <ListEmpty
                isFiltered={isFiltered}
                onReset={reset}
                what={t('orders.what')}
                emptyHint={t('orders.emptyHint')}
              />
            )}

            {cursor ? (
              <Button
                variant="outlined"
                onClick={loadMore}
                data-testid="orders-load-more"
                sx={{ alignSelf: 'center' }}
              >
                {t('orders.loadMore')}
              </Button>
            ) : null}
          </Stack>
        )}
      </QueryState>
    </Stack>
  );
}
