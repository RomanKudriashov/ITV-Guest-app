import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import GroupWorkOutlinedIcon from '@mui/icons-material/GroupWorkOutlined';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/EmptyState';
import { BoardColumn } from '../components/BoardColumn';
import { CancelDialog } from '../components/CancelDialog';
import { OrderCard } from '../components/OrderCard';
import { OrderDetailSheet } from '../components/OrderDetailSheet';
import { TrackerTopBar } from '../components/TrackerTopBar';
import { useBoardLive, type BoardLiveEvent } from '../hooks/useBoardLive';
import { useOrderActions } from '../hooks/useOrderActions';
import { usePointSelection } from '../hooks/usePointSelection';
import { useTrackerSound } from '../hooks/useTrackerSound';
import { useTrackerBoard, useTrackerPoints } from '../hooks/useTrackerQueries';
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

  const pointsQuery = useTrackerPoints();
  const points = pointsQuery.data?.points;
  const { selected: pointCode, select } = usePointSelection(points);

  const boardQuery = useTrackerBoard(pointCode, scope, pollMs);
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
  const openOrder = allOrders.find((order) => order.id === openOrderId) ?? null;

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
        />
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

      {!wide && columns.length ? (
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
              label={
                <Badge
                  color="primary"
                  badgeContent={column.orders.length}
                  sx={{ '& .MuiBadge-badge': { right: -12, top: 2 } }}
                >
                  <Box component="span" sx={{ pr: 1.5 }}>
                    {column.title}
                  </Box>
                </Badge>
              }
            />
          ))}
        </Tabs>
      ) : null}

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
        ) : !allOrders.length ? (
          <Box data-testid="tracker-empty">
            <EmptyState
              title={
                scope === 'history'
                  ? t('tracker.board.emptyHistoryTitle')
                  : t('tracker.board.emptyTitle')
              }
              description={
                scope === 'history'
                  ? t('tracker.board.emptyHistoryBody')
                  : t('tracker.board.emptyBody')
              }
            />
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
        loading={boardQuery.isLoading}
        busy={Boolean(openOrder && actions.pendingOrderId === openOrder.id)}
        errorText={openOrder ? errorFor(openOrder) : null}
        onClose={closeDetail}
        onAccept={() => openOrder && void actions.accept(openOrder.id)}
        onStatus={(code) => openOrder && void actions.changeStatus(openOrder.id, code)}
        onCancel={() => openOrder && setCancelTarget(openOrder)}
      />

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
