import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import { useTranslation } from 'react-i18next';

import { useDraftState } from '@/state/useDraftState';
import { useAnalyticsLanguage } from '../analytics/format';
import { replyToReview, type CmsReview } from './api';

/**
 * Отзыв в разделе: кто, о чём, где — и ответ гостю.
 *
 * ДОЙДЁТ ЛИ ОТВЕТ — ГОВОРИМ ДО ОТВЕТА. Мёртвая сессия гостя означает, что
 * сообщение в чат уйдёт в пустоту, а персонал решит, что ответил. Поэтому
 * предупреждение стоит над полем ввода, а у сохранённого ответа — честная
 * отметка «дошёл» или «только сохранён».
 */
export function ReviewCard({
  review,
  onChanged,
}: {
  review: CmsReview;
  onChanged: (next: CmsReview) => void;
}) {
  const { t } = useTranslation();
  const language = useAnalyticsLanguage();
  const [open, setOpen] = useState(false);
  const [text, setText, resetText] = useDraftState<string>(() => '', review.id);

  const mutation = useMutation({
    mutationFn: () => replyToReview(review.id, text.trim()),
    onSuccess: (next) => {
      resetText();
      setOpen(false);
      onChanged(next);
    },
  });

  const when = new Intl.DateTimeFormat(language, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(review.created_at));

  return (
    <Card variant="outlined" data-testid={`reviews-row-${review.order_number}`}>
      <CardContent sx={{ py: 1.5 }}>
        <Stack spacing={1}>
          <Stack direction="row" spacing={1.25} alignItems="center" flexWrap="wrap" useFlexGap>
            <Box
              aria-label={t('reviews.row.rating', { rating: review.rating })}
              data-testid={`reviews-rating-${review.order_number}`}
              sx={{ display: 'inline-flex', color: review.is_low ? 'error.main' : 'warning.main' }}
            >
              {[1, 2, 3, 4, 5].map((n) =>
                n <= review.rating ? (
                  <StarIcon key={n} fontSize="small" />
                ) : (
                  <StarBorderIcon key={n} fontSize="small" sx={{ color: 'text.disabled' }} />
                ),
              )}
            </Box>
            <Typography variant="subtitle2">
              {t('reviews.row.order', { number: review.order_number })}
            </Typography>
            {review.points.map((point) => (
              <Chip key={point.id} size="small" variant="outlined" label={point.title} />
            ))}
            {review.room ? (
              <Typography variant="body2" color="text.secondary">
                {t('reviews.row.room', { room: review.room })}
              </Typography>
            ) : null}
            <Box sx={{ flexGrow: 1 }} />
            {review.is_low ? (
              <Chip size="small" color="error" label={t('reviews.row.low')} />
            ) : null}
            <Typography variant="caption" color="text.secondary">
              {when}
            </Typography>
          </Stack>

          <Typography
            variant="body2"
            color={review.comment ? 'text.primary' : 'text.secondary'}
            sx={{ whiteSpace: 'pre-wrap' }}
          >
            {review.comment || t('reviews.row.noComment')}
          </Typography>

          {review.reply ? (
            <Box
              data-testid={`reviews-reply-${review.order_number}`}
              sx={{ borderLeft: 3, borderColor: 'divider', pl: 1.5 }}
            >
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                {review.reply.text}
              </Typography>
              <Typography
                variant="caption"
                color={review.reply.delivered ? 'text.secondary' : 'warning.main'}
                data-testid={`reviews-reply-status-${review.order_number}`}
              >
                {review.reply.delivered
                  ? t('reviews.reply.delivered', { by: review.reply.by })
                  : t('reviews.reply.keptOnly', { by: review.reply.by })}
              </Typography>
            </Box>
          ) : open ? (
            <Stack spacing={1}>
              {review.guest_reachable ? null : (
                <Alert severity="warning" data-testid={`reviews-unreachable-${review.order_number}`}>
                  {t('reviews.reply.unreachable')}
                </Alert>
              )}
              <TextField
                multiline
                minRows={2}
                size="small"
                autoFocus
                placeholder={t('reviews.reply.placeholder')}
                value={text}
                onChange={(event) => setText(event.target.value)}
                inputProps={{ 'data-testid': `reviews-reply-input-${review.order_number}`, maxLength: 2000 }}
              />
              {mutation.error ? (
                <Alert severity="error">
                  {mutation.error instanceof Error ? mutation.error.message : t('reviews.reply.failed')}
                </Alert>
              ) : null}
              <Stack direction="row" spacing={1}>
                <Button
                  variant="contained"
                  disabled={!text.trim() || mutation.isPending}
                  onClick={() => mutation.mutate()}
                  data-testid={`reviews-reply-send-${review.order_number}`}
                >
                  {review.guest_reachable ? t('reviews.reply.send') : t('reviews.reply.keep')}
                </Button>
                <Button onClick={() => setOpen(false)}>{t('reviews.reply.cancel')}</Button>
              </Stack>
            </Stack>
          ) : (
            <Stack direction="row" spacing={1} alignItems="center">
              <Button
                size="small"
                onClick={() => setOpen(true)}
                data-testid={`reviews-reply-open-${review.order_number}`}
              >
                {t('reviews.reply.open')}
              </Button>
              {review.guest_reachable ? null : (
                <Typography variant="caption" color="text.secondary">
                  {t('reviews.reply.guestLeft')}
                </Typography>
              )}
            </Stack>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
