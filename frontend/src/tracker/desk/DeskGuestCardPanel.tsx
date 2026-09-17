import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { useDeskGuestCard } from '../hooks/useTrackerQueries';
import type { DeskOrderRow } from '../api/types';

/**
 * Карточка гостя — то, ради чего рабочее место отдельное: ресепшен отвечает,
 * зная контекст, а не переспрашивая.
 */
export function DeskGuestCardPanel({ threadId }: { threadId: string | null }) {
  const { t, i18n } = useTranslation();
  const { data, isLoading, error } = useDeskGuestCard(threadId);
  const language = i18n.resolvedLanguage ?? 'en';

  if (!threadId) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
        {t('tracker.desk.pickDialog')}
      </Typography>
    );
  }
  if (isLoading) {
    return (
      <Stack spacing={1} sx={{ p: 2 }}>
        <Skeleton variant="rounded" height={60} />
        <Skeleton variant="rounded" height={120} />
      </Stack>
    );
  }
  if (error || !data) {
    return (
      <Alert severity="error" sx={{ m: 2 }}>
        {t('tracker.desk.cardFailed')}
      </Alert>
    );
  }

  const day = (iso: string) =>
    new Intl.DateTimeFormat(language, {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));

  return (
    <Stack spacing={1.5} sx={{ p: 2 }} data-testid="desk-guest-card">
      <Stack spacing={0.5}>
        <Typography variant="h6" data-testid="desk-guest-room">
          {data.room ? t('tracker.chat.room', { room: data.room }) : t('tracker.chat.noRoom')}
        </Typography>
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
          {data.language ? (
            <Chip
              size="small"
              label={t('tracker.desk.language', { lang: data.language.toUpperCase() })}
              data-testid="desk-guest-language"
            />
          ) : null}
          <Chip
            size="small"
            variant="outlined"
            color={data.room_verified ? 'success' : 'default'}
            label={data.room_verified ? t('tracker.desk.verified') : t('tracker.desk.notVerified')}
          />
          {!data.reachable ? (
            <Chip
              size="small"
              color="warning"
              label={t('tracker.desk.gone')}
              data-testid="desk-guest-gone"
            />
          ) : null}
        </Stack>
        {data.stay_since ? (
          <Typography variant="caption" color="text.secondary">
            {t('tracker.desk.staySince', { at: day(data.stay_since) })}
          </Typography>
        ) : null}
      </Stack>

      {data.had_low_review ? (
        <Alert severity="warning" data-testid="desk-guest-low-review">
          {t('tracker.desk.lowReview', { count: data.low_reviews.length })}
          {data.low_reviews.slice(0, 2).map((review) => (
            <Typography key={review.id} variant="caption" display="block">
              {'★'.repeat(review.rating)} · №{review.order_number}
              {review.comment ? ` · «${review.comment}»` : ''}
            </Typography>
          ))}
        </Alert>
      ) : null}

      <Section title={t('tracker.desk.task.tasks', { count: data.tasks.length })}>
        {data.tasks.length ? (
          <Stack spacing={0.75} data-testid="desk-guest-tasks">
            {data.tasks.map((task) => (
              <Box key={task.id} data-testid={`desk-task-${task.number}`}>
                <OrderRow order={task} />
                {task.comment ? (
                  <Typography variant="caption" color="text.secondary" display="block">
                    «{task.comment}»
                  </Typography>
                ) : null}
              </Box>
            ))}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {t('tracker.desk.task.noTasks')}
          </Typography>
        )}
      </Section>

      <Section title={t('tracker.desk.activeOrders', { count: data.active_orders.length })}>
        {data.active_orders.length ? (
          <Stack spacing={0.75} data-testid="desk-guest-active">
            {data.active_orders.map((order) => (
              <OrderRow key={order.id} order={order} />
            ))}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {t('tracker.desk.noActive')}
          </Typography>
        )}
      </Section>

      <Divider />

      <Section title={t('tracker.desk.history', { count: data.history_total })}>
        {data.history.length ? (
          <Stack spacing={0.75} data-testid="desk-guest-history">
            {data.history.map((order) => (
              <OrderRow key={order.id} order={order} />
            ))}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {t('tracker.desk.noHistory')}
          </Typography>
        )}
      </Section>
    </Stack>
  );
}

function OrderRow({ order }: { order: DeskOrderRow }) {
  const { t } = useTranslation();
  const color = order.status.is_cancelled
    ? 'default'
    : order.status.is_terminal
      ? 'success'
      : ((order.status.color_token as 'info' | 'warning' | 'success' | 'error' | undefined) ??
        'info');
  return (
    <Box data-testid={`desk-order-${order.number}`}>
      <Stack direction="row" spacing={0.75} alignItems="center">
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          №{order.number}
        </Typography>
        <Chip
          size="small"
          color={color === 'default' ? 'default' : color}
          label={order.status.title}
        />
        {order.delivery_mode === 'pickup' ? (
          <Chip size="small" variant="outlined" label={t('tracker.card.pickup')} />
        ) : null}
      </Stack>
      <Typography variant="caption" color="text.secondary" display="block" noWrap>
        {order.point}
        {order.summary ? ` · ${order.summary}` : ''}
        {order.extra_count ? ` +${order.extra_count}` : ''}
      </Typography>
    </Box>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Stack spacing={0.75}>
      <Typography variant="overline" color="text.secondary">
        {title}
      </Typography>
      {children}
    </Stack>
  );
}
