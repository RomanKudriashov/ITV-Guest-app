import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/auth/AuthProvider';
import { QueryState } from '@/components/QueryState';
import { DateField } from '@/components/DateField';
import { PageContainer } from '@/components/PageContainer';
import { SearchField } from '@/components/SearchField';
import { SelectField } from '@/components/SelectField';
import { ListEmpty } from '@/kit/list/ListEmpty';
import { useListQuery } from '@/kit/list/useListQuery';
import { fetchOrders, type OrdersPage as OrdersPageBody } from './api';
import { OrderCardDetail } from './OrderCardDetail';
import { OrdersNumbers } from './OrdersNumbers';

/*
  СТАТУС ЖИВЁТ ТОЛЬКО В АДРЕСЕ, И ЭТО РЕШЕНИЕ, А НЕ ЗАБЫТЫЙ ОРГАН.

  Списка статусов у раздела нет: их состав задаётся потоком заведения, и
  собрать общий список по всем заведениям отеля — значит показать управляющему
  спа статусы кухни. Ради одного селекта заводить ручку «статусы отеля» дорого,
  а собрать их по видимой странице нельзя: на второй странице список поедет.

  Параметр при этом принимается и работает — по нему приходят ссылки снаружи
  (например, «покажи отменённые за вчера»), и сервер сужает выборку честно.
*/
/** Равные колонки фильтров: края совпадают при любом переносе (партия 55). */
const FILTER_GRID_SX = {
  display: 'grid',
  gap: 1.5,
  gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
  alignItems: 'center',
} as const;

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
    // Список обновляется сам раз в 30 с, пока вкладка видна (партия 55):
    // иначе «здесь появятся заказы» не сбывалось без перезагрузки. Когда
    // догружены следующие страницы — не обновляем: queryFn сбрасывает
    // листание на первую, и прочитанное пропало бы из-под руки.
    refetchInterval: pages.length > 1 ? false : 30_000,
    refetchIntervalInBackground: false,
  });

  const loadMore = async () => {
    if (!cursor) return;
    const body = await fetchOrders(params, cursor);
    setPages((previous) => [...previous, body]);
    setCursor(body.next_cursor);
  };

  const rows = pages.flatMap((page) => page.orders);
  const venues = query.data?.points ?? [];
  const { user } = useAuth();

  return (
    <PageContainer testId="cms-orders">
      <Stack spacing={2}>
        <Typography variant="h5" data-testid="cms-page-title">
          {t('orders.title')}
        </Typography>

        <QueryState query={query} what={t('orders.what')}>
          {(body) => (
            <Stack spacing={2}>
              <OrdersNumbers summary={body.summary} />

              <Card variant="outlined">
                <CardContent>
                  {/* Фильтры — в одной сетке равных колонок (партия 55): ширины по
                      месту (180, 120, 150, 160) давали лестницу краёв при переносе. */}
                  <Box sx={FILTER_GRID_SX}>
                    <SelectField
                      size="small"
                      label={t('orders.filters.venue')}
                      value={params.point}
                      onChange={(next) => patch({ point: next })}
                      testId="orders-filter-venue"
                      options={[
                        { value: '', label: t('orders.filters.allVenues') },
                        ...venues.map((venue) => ({ value: venue.id, label: venue.title })),
                      ]}
                    />

                    <DateField
                      size="small"
                      fullWidth
                      label={t('orders.filters.since')}
                      value={params.since}
                      onChange={(next) => patch({ since: next })}
                      testId="orders-filter-since"
                    />
                    <DateField
                      size="small"
                      fullWidth
                      label={t('orders.filters.until')}
                      value={params.until}
                      onChange={(next) => patch({ until: next })}
                      testId="orders-filter-until"
                    />
                    <TextField
                      size="small"
                      label={t('orders.filters.room')}
                      value={params.room}
                      onChange={(event) => patch({ room: event.target.value })}
                      fullWidth
                      inputProps={{ 'data-testid': 'orders-filter-room' }}
                    />
                    {/*
                      ТИП ЗАКАЗА — ДВА ЗНАЧЕНИЯ, И СПИСКА С СЕРВЕРА ЕМУ НЕ НАДО:
                      корзина и заявка заданы потоком, а не содержимым отеля.
                      Подписи взяты у трекера, а не заведены свои: одно и то же
                      на двух экранах обязано называться одинаково, иначе через
                      полгода это будут два разных списка.
                    */}
                    <SelectField
                      size="small"
                      label={t('tracker.filters.type')}
                      value={params.order_type}
                      onChange={(next) => patch({ order_type: next })}
                      testId="orders-filter-type"
                      options={[
                        { value: '', label: t('tracker.filters.anyType') },
                        { value: 'cart', label: t('tracker.filters.typeCart') },
                        { value: 'request', label: t('tracker.filters.typeRequest') },
                      ]}
                    />

                    {/* Поиск — по правилу полей: лупа и подсказка, без подписи (партия 55). */}
                    <SearchField
                      placeholder={t('orders.filters.search')}
                      value={params.search}
                      onChange={(value) => patch({ search: value })}
                      fullWidth
                      testId="orders-filter-search"
                    />
                    {isFiltered ? (
                      <Box>
                        <Button onClick={reset} data-testid="orders-filter-reset">
                          {t('orders.filters.reset')}
                        </Button>
                      </Box>
                    ) : null}
                  </Box>
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
                  emptyHint={
                    /* Подпись — по области, а не одна на всех (партия 31, QA п.14):
                       старший ресепшен видит только «Ресепшен», где заказов нет, а
                       читал «все заведения сразу». */
                    user?.is_hotel_admin || !venues.length
                      ? t('orders.emptyHint')
                      : t('orders.emptyHintScoped', { venues: venues.map((venue) => venue.title).join(', ') })
                  }
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
    </PageContainer>
  );
}
