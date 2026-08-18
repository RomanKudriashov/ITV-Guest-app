import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import TextField from '@mui/material/TextField';

import { useListQuery } from '@/kit/list/useListQuery';
import { useMatch, useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { alpha, useTheme } from '@mui/material/styles';
import GroupWorkOutlinedIcon from '@mui/icons-material/GroupWorkOutlined';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/EmptyState';
import { BoardColumn } from '../components/BoardColumn';
import { CancelDialog } from '../components/CancelDialog';
import { OrderCard } from '../components/OrderCard';
import { OrderDetailSheet } from '../components/OrderDetailSheet';
import { TrackerChatPanel } from '../components/TrackerChatPanel';
import { TrackerTopBar } from '../components/TrackerTopBar';
import { useBoardLive, type BoardLiveEvent } from '../hooks/useBoardLive';
import { useOrderActions } from '../hooks/useOrderActions';
import { usePointSelection } from '../hooks/usePointSelection';
import { useTrackerSound } from '../hooks/useTrackerSound';
import {
  useTrackerBoard,
  useTrackerChatThreads,
  useTrackerOrder,
  useTrackerPoints,
} from '../hooks/useTrackerQueries';
import { trackerErrorMessage } from '../errors';
import type { TrackerOrder, TrackerScope } from '../api/types';

/** How long a freshly changed order keeps its ring. */
const HIGHLIGHT_MS = 30_000;
/** Fallback polling while the socket is down. */
const OFFLINE_POLL_MS = 15_000;

export function TrackerPage() {
  const { t } = useTranslation();
  const theme = useTheme();
  const navigate = useNavigate();
  const wide = useMediaQuery(theme.breakpoints.up('md'));
  const detailMatch = useMatch('/tracker/order/:id');
  const openOrderId = detailMatch?.params.id ?? null;

  const [scope, setScope] = useState<TrackerScope>('active');
  const [activeColumn, setActiveColumn] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<Record<string, number>>({});
  const [pollMs, setPollMs] = useState<number | undefined>(undefined);
  const [cancelTarget, setCancelTarget] = useState<TrackerOrder | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

  // Threads drive the top-bar badge; the socket of an open thread invalidates
  // this query so the count moves on its own.
  const threadsQuery = useTrackerChatThreads();
  const chatUnread = (threadsQuery.data ?? []).reduce((sum, thread) => sum + thread.unread, 0);

  const pointsQuery = useTrackerPoints();
  const points = pointsQuery.data?.points;
  const { selected: pointCode, select } = usePointSelection(points);

  // День ленты записей. Пустая строка = «сегодня по времени отеля»: считать
  // сегодняшнюю дату на клиенте нельзя — у отеля своя таймзона, и в полночь
  // клиент и сервер разошлись бы на сутки.
  const [day, setDay] = useState('');
  /*
    Поиск на доске — в адресе и НА СЕРВЕРЕ.

    719 заказов, и человек ищет конкретный: по номеру заказа или по номеру
    комнаты. Отсев уже полученной доски врал бы так же, как врал журнал
    платформы, а живой контур при этом не ломается: нефильтрованный снимок из
    сокета в отфильтрованную доску не подменяется, она перечитывает своё.
  */
  const { params: listParams, patch: patchList } = useListQuery({ search: '' });
  const boardQuery = useTrackerBoard(
    pointCode,
    scope,
    pollMs,
    day || undefined,
    listParams.search,
  );
  const sound = useTrackerSound();
  const actions = useOrderActions();

  // Sound fires on the EVENT, not on every snapshot: a snapshot arrives on every
  // status change of every order, and a kitchen that beeps constantly gets muted.
  const soundRef = useRef(sound.play);
  soundRef.current = sound.play;

  const onLiveEvent = useCallback((message: BoardLiveEvent) => {
    if (message.event === 'order.created') soundRef.current();
    if (message.orderId) {
      const id = message.orderId;
      setHighlighted((previous) => ({ ...previous, [id]: Date.now() }));
    }
  }, []);

  const live = useBoardLive(pointCode, Boolean(pointCode), onLiveEvent);

  // The socket owns the board; polling is the honest fallback when it is down.
  useEffect(() => {
    setPollMs(live === 'online' ? undefined : OFFLINE_POLL_MS);
  }, [live]);

  // Expire highlights so the board calms down on its own.
  useEffect(() => {
    if (!Object.keys(highlighted).length) return;
    const timer = window.setTimeout(() => {
      const cutoff = Date.now() - HIGHLIGHT_MS;
      setHighlighted((previous) => {
        const next = Object.fromEntries(
          Object.entries(previous).filter(([, at]) => at > cutoff),
        );
        return Object.keys(next).length === Object.keys(previous).length ? previous : next;
      });
    }, HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [highlighted]);

  const columns = useMemo(() => boardQuery.data?.columns ?? [], [boardQuery.data]);

  // Which shape the server asked for. Records (spa) come as one ordered day —
  // grouping an appointment by status would hide the only thing that matters
  // there, which is who comes next.
  const timeline = boardQuery.data?.layout === 'timeline' && scope === 'active';

  // Сервер отвечает, какой день показал (в таймзоне отеля) — от него и шагаем.
  const shownDay = columns[0]?.date ?? '';
  const shiftDay = useCallback(
    (days: number) => {
      if (!shownDay) return;
      const next = new Date(`${shownDay}T12:00:00Z`);
      next.setUTCDate(next.getUTCDate() + days);
      setDay(next.toISOString().slice(0, 10));
    },
    [shownDay],
  );

  // Keep the phone tab valid when the preset changes under our feet.
  useEffect(() => {
    if (!columns.length) return;
    if (columns.some((column) => column.code === activeColumn)) return;
    setActiveColumn(columns[0].code);
  }, [columns, activeColumn]);

  const allOrders = useMemo(
    () => columns.flatMap((column) => column.orders),
    [columns],
  );
  const boardOrder = allOrders.find((order) => order.id === openOrderId) ?? null;

  // The snapshot wins: tapping a card must not cost a request. The dedicated
  // endpoint is only for a cold deep link — another point, the history scope, or
  // a page opened straight from a message.
  const detailQuery = useTrackerOrder(
    openOrderId ?? undefined,
    Boolean(openOrderId) && !boardOrder && !boardQuery.isLoading,
  );
  const openOrder = boardOrder ?? detailQuery.data ?? null;

  const closeDetail = useCallback(() => navigate('/tracker'), [navigate]);

  const errorFor = (order: TrackerOrder): string | null =>
    actions.actionError && actions.actionError.orderId === order.id
      ? trackerErrorMessage(actions.actionError.error, t)
      : null;

  const renderCard = (order: TrackerOrder) => (
    <OrderCard
      key={order.id}
      order={order}
      busy={actions.pendingOrderId === order.id}
      highlighted={Boolean(highlighted[order.id])}
      errorText={errorFor(order)}
      onOpen={() => navigate(`/tracker/order/${order.id}`)}
      onAccept={() => void actions.accept(order.id)}
      onStatus={(code) => void actions.changeStatus(order.id, code)}
      onCancel={() => setCancelTarget(order)}
    />
  );

  // ---- gates ---------------------------------------------------------------

  if (pointsQuery.isLoading) {
    return (
      <Stack sx={{ minHeight: '100vh' }} alignItems="center" justifyContent="center">
        <CircularProgress aria-label={t('tracker.loading')} />
      </Stack>
    );
  }

  if (pointsQuery.error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void pointsQuery.refetch()}>
              {t('tracker.retry')}
            </Button>
          }
        >
          {trackerErrorMessage(pointsQuery.error, t)}
        </Alert>
      </Box>
    );
  }

  // No assignment is not an error — it is a different screen, not an empty board.
  if (!points?.length) {
    return (
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
        <TrackerTopBar
          points={[]}
          onSelect={select}
          live={live}
          soundEnabled={sound.enabled}
          onToggleSound={sound.toggle}
          chatUnread={chatUnread}
          onOpenChat={() => setChatOpen(true)}
        />
        <TrackerChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
        <Box data-testid="tracker-no-points" sx={{ pt: 6 }}>
          <EmptyState
            icon={<GroupWorkOutlinedIcon fontSize="large" />}
            title={t('tracker.noPoints.title')}
            description={t('tracker.noPoints.body')}
            action={
              <Button variant="outlined" onClick={() => navigate('/cms/menu')} sx={{ minHeight: 44 }}>
                {t('tracker.toCms')}
              </Button>
            }
          />
        </Box>
      </Box>
    );
  }

  const currentColumn =
    columns.find((column) => column.code === activeColumn) ?? columns[0] ?? null;

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <TrackerTopBar
        points={points}
        selected={pointCode}
        onSelect={select}
        live={live}
        soundEnabled={sound.enabled}
        onToggleSound={sound.toggle}
        chatUnread={chatUnread}
        onOpenChat={() => setChatOpen(true)}
      />

      <Tabs
        value={scope}
        onChange={(_event, next: TrackerScope) => setScope(next)}
        variant="fullWidth"
        sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}
      >
        <Tab
          value="active"
          label={t('tracker.scope.active')}
          data-testid="tracker-active-tab"
          sx={{ minHeight: 48 }}
        />
        <Tab
          value="history"
          label={t('tracker.scope.history')}
          data-testid="tracker-history-tab"
          sx={{ minHeight: 48 }}
        />
      </Tabs>

      {!wide && columns.length && !timeline ? (
        <Tabs
          value={currentColumn?.code ?? false}
          onChange={(_event, next: string) => setActiveColumn(next)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}
        >
          {columns.map((column) => (
            <Tab
              key={column.code}
              value={column.code}
              data-testid={`tracker-tab-${column.code}`}
              sx={{ minHeight: 48 }}
              /*
                Счётчик стоит В СТРОКЕ с названием, а не значком поверх него.
                Значок висел на `right: -12`, то есть ЗА границей вкладки, и на
                телефоне его срезало вместе с числом: «4|5» вместо «4» и «5» —
                повар видел обрубок и не понимал, сколько заказов в колонке.
                Строка ужимается вместе с вкладкой и обрезаться не может.
              */
              label={
                <Box
                  component="span"
                  sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}
                >
                  {column.title}
                  <Box
                    component="span"
                    sx={(th) => ({
                      minWidth: 20,
                      px: 0.6,
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 700,
                      lineHeight: '18px',
                      bgcolor: alpha(th.palette.primary.main, 0.16),
                      color: th.palette.primary.main,
                    })}
                  >
                    {column.orders.length}
                  </Box>
                </Box>
              }
            />
          ))}
        </Tabs>
      ) : null}

      {/* Поиск по доске. Рядом с ней, а не в шапке: он про эту доску. */}
      <Box sx={{ px: { xs: 1.5, md: 2 }, pt: { xs: 1.5, md: 2 } }}>
        <TextField
          size="small"
          fullWidth
          value={listParams.search}
          onChange={(event) => patchList({ search: event.target.value })}
          placeholder={t('tracker.searchPlaceholder')}
          inputProps={{ 'data-testid': 'tracker-search', inputMode: 'numeric' }}
        />
      </Box>

      <Box sx={{ p: { xs: 1.5, md: 2 } }} data-testid="tracker-board">
        {boardQuery.isLoading ? (
          <Stack alignItems="center" sx={{ py: 6 }}>
            <CircularProgress aria-label={t('tracker.loading')} />
          </Stack>
        ) : boardQuery.error ? (
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={() => void boardQuery.refetch()}>
                {t('tracker.retry')}
              </Button>
            }
          >
            {trackerErrorMessage(boardQuery.error, t)}
          </Alert>
        ) : !allOrders.length && !timeline ? (
          // У ленты пустой день — не пустая доска: переключатель дня обязан
          // остаться, иначе из пустого сегодня некуда шагнуть.
          <Box data-testid="tracker-empty">
            {/* Под поиском — «ничего не найдено», а не «доска пуста»: это
                разные ответы, и второй заставил бы искать несуществующую
                причину, почему заказов «нет». */}
            <EmptyState
              title={
                listParams.search
                  ? t('list.nothingFound')
                  : scope === 'history'
                    ? t('tracker.board.emptyHistoryTitle')
                    : t('tracker.board.emptyTitle')
              }
              description={
                listParams.search
                  ? t('list.nothingFoundHint')
                  : scope === 'history'
                    ? t('tracker.board.emptyHistoryBody')
                    : t('tracker.board.emptyBody')
              }
            />
          </Box>
        ) : timeline ? (
          // Лента записей: один день по времени слота, во всю ширину. Колонок
          // здесь нет по существу задачи, а не ради экономии места.
          <Box
            sx={{ maxWidth: 720, mx: 'auto' }}
            data-testid="tracker-timeline"
            // День, который РЕАЛЬНО показан, — в таймзоне отеля. Клиенту он
            // нужен и для шага по дням, и чтобы не вычислять «сегодня» самому.
            data-day={shownDay}
          >
            {columns.map((column) => (
              <Stack key={column.code} spacing={1.5}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Button
                    size="small"
                    onClick={() => shiftDay(-1)}
                    data-testid="tracker-day-prev"
                    sx={{ minWidth: 44 }}
                  >
                    ←
                  </Button>
                  <Typography variant="overline" color="text.secondary" sx={{ flexGrow: 1 }}>
                    {t('tracker.board.day', { date: column.date ?? column.title })}
                  </Typography>
                  {day ? (
                    <Button size="small" onClick={() => setDay('')} data-testid="tracker-day-today">
                      {t('tracker.board.today')}
                    </Button>
                  ) : null}
                  <Button
                    size="small"
                    onClick={() => shiftDay(1)}
                    data-testid="tracker-day-next"
                    sx={{ minWidth: 44 }}
                  >
                    →
                  </Button>
                </Stack>
                {column.orders.length ? (
                  column.orders.map(renderCard)
                ) : (
                  <EmptyState
                    title={t('tracker.board.emptyTimelineTitle')}
                    description={t('tracker.board.emptyTimelineBody')}
                  />
                )}
              </Stack>
            ))}
          </Box>
        ) : wide ? (
          <Stack direction="row" spacing={2} alignItems="flex-start">
            {columns.map((column) => (
              <BoardColumn key={column.code} column={column}>
                {column.orders.map(renderCard)}
              </BoardColumn>
            ))}
          </Stack>
        ) : currentColumn ? (
          <BoardColumn column={currentColumn} showHeader={false}>
            {currentColumn.orders.map(renderCard)}
          </BoardColumn>
        ) : null}

        {boardQuery.data?.server_time ? (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', textAlign: 'center', pt: 2 }}
          >
            {live === 'online' ? t('tracker.liveOn') : t('tracker.liveOff')}
          </Typography>
        ) : null}
      </Box>

      <OrderDetailSheet
        order={openOrder}
        open={Boolean(openOrderId)}
        loading={boardQuery.isLoading || detailQuery.isLoading}
        loadError={
          !openOrder && detailQuery.error ? trackerErrorMessage(detailQuery.error, t) : null
        }
        busy={Boolean(openOrder && actions.pendingOrderId === openOrder.id)}
        errorText={openOrder ? errorFor(openOrder) : null}
        onClose={closeDetail}
        onAccept={() => openOrder && void actions.accept(openOrder.id)}
        onStatus={(code) => openOrder && void actions.changeStatus(openOrder.id, code)}
        onCancel={() => openOrder && setCancelTarget(openOrder)}
      />

      <TrackerChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />

      <CancelDialog
        open={Boolean(cancelTarget)}
        orderId={cancelTarget?.id ?? null}
        orderNumber={cancelTarget?.number ?? null}
        busy={Boolean(cancelTarget && actions.pendingOrderId === cancelTarget.id)}
        onClose={() => setCancelTarget(null)}
        onConfirm={(reason) => {
          const target = cancelTarget;
          setCancelTarget(null);
          if (target) void actions.cancel(target.id, reason);
        }}
      />
    </Box>
  );
}
