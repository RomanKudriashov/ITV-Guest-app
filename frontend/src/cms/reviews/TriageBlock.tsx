import { useMutation } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { useDraftState } from '@/state/useDraftState';
import { useAnalyticsLanguage } from '../analytics/format';
import { triageReview, type CmsReview, type TriageStatus, type TriageStep } from './api';

const TONE: Record<TriageStatus, 'error' | 'warning' | 'success'> = {
  new: 'error',
  in_progress: 'warning',
  closed: 'success',
};

export function TriageChip({ status, testId }: { status: TriageStatus; testId?: string }) {
  const { t } = useTranslation();
  return (
    <Chip
      size="small"
      variant={status === 'closed' ? 'outlined' : 'filled'}
      color={TONE[status]}
      label={t(`reviews.triage.status.${status}`)}
      data-testid={testId}
    />
  );
}

/**
 * РАЗБОР: статус и что сделали.
 *
 * Закрыть можно только со словами — закрытый молча отзыв не отличается от
 * забытого. История показывает каждый шаг: кто, когда, что написал.
 */
export function TriageBlock({
  review,
  history,
  onChanged,
}: {
  review: CmsReview;
  history: TriageStep[];
  onChanged: (next: CmsReview) => void;
}) {
  const { t } = useTranslation();
  const language = useAnalyticsLanguage();
  const [comment, setComment, resetComment] = useDraftState<string>(() => '', review.id);

  const mutation = useMutation({
    mutationFn: (status: TriageStatus) => triageReview(review.id, status, comment.trim()),
    onSuccess: (next) => {
      resetComment();
      onChanged(next);
    },
  });

  const status = review.triage;
  const hasText = Boolean(comment.trim());
  const when = (iso: string) =>
    new Intl.DateTimeFormat(language, {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }} data-testid="review-triage">
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="subtitle2">{t('reviews.triage.title')}</Typography>
          <TriageChip status={status} testId="review-triage-status" />
        </Stack>

        {history.length ? (
          <Stack spacing={0.5} data-testid="review-triage-history">
            {history.map((step, index) => (
              <Typography key={index} variant="caption" color="text.secondary">
                {when(step.at)} · {step.by || t('reviews.triage.system')} ·{' '}
                {t(`reviews.triage.status.${step.to}`)}
                {step.comment ? ` — ${step.comment}` : ''}
              </Typography>
            ))}
          </Stack>
        ) : (
          <Typography variant="caption" color="text.secondary">
            {t('reviews.triage.noSteps')}
          </Typography>
        )}

        <TextField
          multiline
          minRows={2}
          size="small"
          placeholder={
            status === 'closed'
              ? t('reviews.triage.reopenPlaceholder')
              : t('reviews.triage.placeholder')
          }
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          inputProps={{ 'data-testid': 'review-triage-comment', maxLength: 2000 }}
        />
        {mutation.error ? (
          <Alert severity="error">
            {mutation.error instanceof Error ? mutation.error.message : t('reviews.triage.failed')}
          </Alert>
        ) : null}
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {status === 'new' ? (
            <Button
              variant="outlined"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate('in_progress')}
              data-testid="review-triage-take"
            >
              {t('reviews.triage.take')}
            </Button>
          ) : null}
          {status === 'in_progress' ? (
            <Button
              variant="outlined"
              disabled={!hasText || mutation.isPending}
              onClick={() => mutation.mutate('in_progress')}
              data-testid="review-triage-note"
            >
              {t('reviews.triage.note')}
            </Button>
          ) : null}
          {status === 'closed' ? (
            <Button
              variant="outlined"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate('in_progress')}
              data-testid="review-triage-reopen"
            >
              {t('reviews.triage.reopen')}
            </Button>
          ) : (
            <Button
              variant="contained"
              disabled={!hasText || mutation.isPending}
              onClick={() => mutation.mutate('closed')}
              data-testid="review-triage-close"
            >
              {t('reviews.triage.close')}
            </Button>
          )}
        </Stack>
        {status !== 'closed' && !hasText ? (
          <Typography variant="caption" color="text.secondary">
            {t('reviews.triage.closeHint')}
          </Typography>
        ) : null}
      </Stack>
    </Paper>
  );
}
