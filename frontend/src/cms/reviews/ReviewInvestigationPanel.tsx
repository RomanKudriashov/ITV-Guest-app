import { useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import type { Theme } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';

import { QueryState } from '@/components/QueryState';
import { useAnalyticsLanguage } from '../analytics/format';
import { fetchInvestigation, type InvestigationPart, type ReviewInvestigation } from './api';

/**
 * РАССЛЕДОВАНИЕ ОТЗЫВА — ВСЁ НА ОДНОМ ЭКРАНЕ.
 *
 * Руководитель не ходит по разделам: какой заказ, какие части, кто вёл, сколько
 * шло, была ли просрочка (по порогу НА МОМЕНТ заказа), срабатывала ли
 * эскалация, что гость писал в чат за время заказа.
 */
export function ReviewInvestigationPanel({
  reviewId,
  onClose,
  children,
}: {
  reviewId: string | null;
  onClose: () => void;
  /** Блок разбора — статус и комментарий (шаг «д»). */
  children?: (data: ReviewInvestigation) => React.ReactNode;
}) {
  const { t } = useTranslation();
  const narrow = useMediaQuery((theme: Theme) => theme.breakpoints.down('md'));
  const query = useQuery({
    queryKey: ['cms', 'reviews', 'one', reviewId],
    queryFn: () => fetchInvestigation(reviewId as string),
    enabled: Boolean(reviewId),
  });

  return (
    <Drawer
      anchor="right"
      open={Boolean(reviewId)}
      onClose={onClose}
      // Выше шапки CMS: у неё `drawer + 1`, и крестик панели оказывался под ней.
      sx={{ zIndex: (theme) => theme.zIndex.modal }}
      PaperProps={
        { sx: { width: narrow ? '100%' : 560 }, 'data-testid': 'review-investigation' } as never
      }
    >
      <Stack direction="row" alignItems="center" sx={{ px: 2, py: 1.5 }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          {t('reviews.investigation.title')}
        </Typography>
        <IconButton
          onClick={onClose}
          aria-label={t('reviews.reply.cancel')}
          data-testid="review-investigation-close"
        >
          <CloseIcon />
        </IconButton>
      </Stack>
      <Divider />
      <Box sx={{ p: 2, overflowY: 'auto' }}>
        {reviewId ? (
          <QueryState query={query} what={t('reviews.investigation.what')}>
            {(data) => <Body data={data}>{children?.(data)}</Body>}
          </QueryState>
        ) : null}
      </Box>
    </Drawer>
  );
}

function useClock() {
  const language = useAnalyticsLanguage();
  const time = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }).format(
          new Date(iso),
        )
      : '—';
  const day = (iso: string) =>
    new Intl.DateTimeFormat(language, {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  return { time, day };
}

function Body({ data, children }: { data: ReviewInvestigation; children?: React.ReactNode }) {
  const { t } = useTranslation();
  const { day } = useClock();
  const { review, order } = data;
  const minutes = (value: number | null) =>
    value === null ? '—' : t('reviews.investigation.minutes', { count: value });

  return (
    <Stack spacing={2}>
      <Stack spacing={0.5}>
        <Typography variant="subtitle1" data-testid="review-investigation-head">
          {t('reviews.investigation.head', { rating: review.rating, number: order.number })}
        </Typography>
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
          {review.comment || t('reviews.row.noComment')}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {day(review.created_at)}
          {order.room ? ` · ${t('reviews.row.room', { room: order.room })}` : ''}
        </Typography>
      </Stack>

      {children}

      <Section title={t('reviews.investigation.order')}>
        <Typography variant="body2">
          {order.lines
            .map((line) => (line.quantity > 1 ? `${line.quantity}× ${line.title}` : line.title))
            .join(', ') || '—'}
        </Typography>
        {order.comment ? (
          <Typography variant="body2" color="text.secondary">
            {t('reviews.investigation.guestComment', { comment: order.comment })}
          </Typography>
        ) : null}
        <Typography variant="body2" data-testid="review-investigation-total">
          {t('reviews.investigation.waited', { time: minutes(order.total_minutes) })}
        </Typography>
      </Section>

      {data.parts.map((part) => (
        <PartCard key={part.order_id} part={part} />
      ))}

      <Section title={t('reviews.investigation.chat')}>
        {data.chat.length ? (
          <Stack spacing={1} data-testid="review-investigation-chat">
            {data.chat.map((message, index) => (
              <Box
                key={index}
                sx={{
                  alignSelf: message.author_type === 'guest' ? 'flex-start' : 'flex-end',
                  maxWidth: '85%',
                  bgcolor: message.author_type === 'guest' ? 'action.hover' : 'primary.main',
                  color: message.author_type === 'guest' ? 'text.primary' : 'primary.contrastText',
                  borderRadius: 2,
                  px: 1.25,
                  py: 0.75,
                }}
              >
                <Typography variant="caption" sx={{ opacity: 0.8 }}>
                  {message.author} · {day(message.at)}
                </Typography>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                  {message.body}
                </Typography>
              </Box>
            ))}
          </Stack>
        ) : (
          <Typography
            variant="body2"
            color="text.secondary"
            data-testid="review-investigation-no-chat"
          >
            {t('reviews.investigation.noChat')}
          </Typography>
        )}
      </Section>
    </Stack>
  );
}

function PartCard({ part }: { part: InvestigationPart }) {
  const { t } = useTranslation();
  const { time } = useClock();
  const minutes = (value: number | null) =>
    value === null ? '—' : t('reviews.investigation.minutes', { count: value });

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }} data-testid={`review-part-${part.number}`}>
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="subtitle2">{part.point.title}</Typography>
          <Typography variant="caption" color="text.secondary">
            №{part.number} · {part.status}
          </Typography>
          {part.delivery_mode === 'pickup' ? (
            <Chip size="small" variant="outlined" label={t('tracker.card.pickup')} />
          ) : null}
          <Box sx={{ flexGrow: 1 }} />
          {part.sla_minutes === null || part.work_minutes === null ? null : part.was_overdue ? (
            <Chip
              size="small"
              color="error"
              data-testid={`review-part-overdue-${part.number}`}
              label={t('reviews.investigation.overdue', { count: part.overdue_minutes })}
            />
          ) : (
            <Chip
              size="small"
              color="success"
              variant="outlined"
              data-testid={`review-part-intime-${part.number}`}
              label={t('reviews.investigation.inTime')}
            />
          )}
        </Stack>
        <Typography variant="body2">
          {t('reviews.investigation.led', {
            who: part.assignee ?? t('reviews.investigation.nobody'),
          })}
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 0.5,
          }}
        >
          <Fact
            label={t('reviews.investigation.reaction')}
            value={minutes(part.reaction_minutes)}
          />
          <Fact label={t('reviews.investigation.work')} value={minutes(part.work_minutes)} />
          <Fact label={t('reviews.investigation.sla')} value={minutes(part.sla_minutes)} />
        </Box>
        {part.reopened ? (
          <Typography variant="caption" color="warning.main">
            {t('reviews.investigation.reopened')}
          </Typography>
        ) : null}
        <Typography
          variant="caption"
          color="text.secondary"
          data-testid={`review-part-escalations-${part.number}`}
        >
          {part.escalations.length
            ? t('reviews.investigation.escalated', {
                count: part.escalations.length,
                times: part.escalations.map((step) => time(step.at)).join(', '),
              })
            : t('reviews.investigation.noEscalation')}
        </Typography>
        <Stack spacing={0.25}>
          {part.history.map((step, index) => (
            <Typography key={index} variant="caption" color="text.secondary">
              {time(step.at)} · {step.title}
              {step.by ? ` · ${step.by}` : ''}
              {step.comment ? ` · «${step.comment}»` : ''}
            </Typography>
          ))}
        </Stack>
      </Stack>
    </Paper>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2">{value}</Typography>
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
