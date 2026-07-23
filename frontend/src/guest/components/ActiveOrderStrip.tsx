import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { pressableSx, revealSx, statusTokenColor } from '@/kit';
import { IconBack } from '@/icons';
import { useGuestActiveOrders } from '../hooks/useGuestQueries';
import { useOrderLive } from '../hooks/useOrderLive';
import { serveByTime } from '../utils/serveBy';
import type { GuestActiveOrder } from '../api/types';

/**
 * Home active-order strip (reference `.ordstrip`). One row per live order,
 * stacked vertically. Each row keeps itself fresh by subscribing to the order's
 * EXISTING WebSocket via `useOrderLive` — the snapshot it receives is written to
 * the query cache and invalidates the `['guest','orders']` prefix, which refetches
 * the whole active list (`useGuestActiveOrders`). Nothing is patched incrementally;
 * a status/serve-by change or an order going terminal is reconciled by re-reading
 * the full list, so a missed frame, a reconnect or a race is harmless.
 */
export function ActiveOrderStrip() {
  const { data } = useGuestActiveOrders();
  const orders = data?.orders ?? [];
  if (!orders.length) return null;

  return (
    <Stack spacing={1.25} data-testid="guest-active-order-strip">
      {orders.map((order, index) => (
        <ActiveOrderRow key={order.id} order={order} index={index} />
      ))}
    </Stack>
  );
}

function ActiveOrderRow({ order, index }: { order: GuestActiveOrder; index: number }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Reuse the per-order channel. Every snapshot invalidates `['guest','orders']`,
  // refetching the strip's list — full-snapshot reconciliation, never a delta.
  useOrderLive(order.id);

  const time = serveByTime(order.serve_by);
  const parts: string[] = [];
  if (order.summary) parts.push(order.summary);
  if (order.extra_count > 0) parts.push(t('guest.home.activeOrder.more', { count: order.extra_count }));
  if (time) parts.push(t('guest.home.activeOrder.serveBy', { time }));
  const detail = parts.join(' · ');

  return (
    <ButtonBase
      data-testid={`guest-active-order-${order.id}`}
      onClick={() => navigate(`/orders/${order.id}`)}
      focusRipple
      sx={(theme) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 1.75,
        width: '100%',
        textAlign: 'start',
        px: 2,
        py: 1.75,
        borderRadius: `${theme.palette.brand.radius.lg}px`,
        border: `1px solid ${theme.palette.divider}`,
        background: `linear-gradient(120deg, ${theme.palette.brand.primarySoft}, transparent 60%), ${theme.palette.background.paper}`,
        ...revealSx({ index }),
        ...pressableSx,
      })}
    >
      <Box
        aria-hidden
        sx={(theme) => {
          const color = statusTokenColor(order.status.color_token, theme);
          return {
            flex: 'none',
            width: 9,
            height: 9,
            borderRadius: '50%',
            bgcolor: color,
            boxShadow: `0 0 0 4px color-mix(in srgb, ${color} 18%, transparent)`,
          };
        }}
      />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontWeight: 700, fontSize: '0.875rem', color: 'text.primary' }}>
          {t('guest.home.activeOrder.title', {
            number: order.number,
            status: order.status.title,
          })}
        </Typography>
        {detail ? (
          <Typography
            sx={{
              fontSize: '0.78rem',
              color: 'text.secondary',
              mt: 0.25,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {detail}
          </Typography>
        ) : null}
      </Box>
      <Stack
        direction="row"
        alignItems="center"
        spacing={0.5}
        sx={{ flex: 'none', color: 'primary.main', fontWeight: 700, fontSize: '0.8rem' }}
      >
        <Box component="span" sx={{ whiteSpace: 'nowrap' }}>
          {t('guest.home.activeOrder.view')}
        </Box>
        {/* IconBack points left; mirror it so the affordance reads as "forward". */}
        <Box sx={{ display: 'flex', transform: 'scaleX(-1)' }}>
          <IconBack size={16} />
        </Box>
      </Stack>
    </ButtonBase>
  );
}
