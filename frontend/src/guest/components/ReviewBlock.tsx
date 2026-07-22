import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { useTranslation } from 'react-i18next';

import { ApiError } from '@/api/client';
import { useDraftState } from '@/state/useDraftState';
import { submitReview } from '../api/guest';
import { guestKeys } from '../api/queryKeys';
import { errorMessage } from '../errors';
import { useGuestLanguage, useGuestReview } from '../hooks/useGuestQueries';
import type { GuestOrder, GuestReview } from '../api/types';

export interface ReviewBlockProps {
  order: GuestOrder;
}

/**
 * "Rate it" block on the status screen of a finished order. Shown only when the
 * server says the guest may review (`order.can_review`) or a review already
 * exists. Reviews are PRIVATE — the note spells that out. One per order: a
 * `409 review_exists` is treated as success ("thanks, noted").
 */
export function ReviewBlock({ order }: ReviewBlockProps) {
  const { t } = useTranslation();
  const language = useGuestLanguage();
  const queryClient = useQueryClient();

  // A terminal, non-cancelled order might already carry a review — look it up.
  // A live or cancelled order never can, so this stays idle there.
  const reviewable = order.status.is_terminal && !order.status.is_cancelled;
  const { data: existing, isLoading } = useGuestReview(order.id, reviewable);

  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment, resetComment] = useDraftState<string>(() => '', order.id);
  const [thanks, setThanks] = useState(false);

  const mutation = useMutation<GuestReview, unknown, void>({
    mutationFn: () => submitReview(order.id, rating, comment.trim(), language),
    onSuccess: (saved) => {
      queryClient.setQueryData(guestKeys.review(order.id), saved);
      resetComment();
      setThanks(true);
    },
    onError: (error) => {
      // Already reviewed — that is a success from the guest's point of view.
      if (error instanceof ApiError && error.code === 'review_exists') {
        setThanks(true);
        void queryClient.invalidateQueries({ queryKey: guestKeys.review(order.id) });
      }
    },
  });

  if (!reviewable || isLoading) return null;

  const privacyNote = (
    <Stack direction="row" spacing={0.75} alignItems="center">
      <LockOutlinedIcon sx={{ fontSize: 15, color: 'text.secondary' }} />
      <Typography variant="caption" color="text.secondary">
        {t('guest.review.privacy')}
      </Typography>
    </Stack>
  );

  // Already left, or just left — show it read-only.
  if (existing) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }} data-testid="guest-review">
        <Stack spacing={1}>
          <Typography variant="subtitle2">{t('guest.review.yours')}</Typography>
          <Stars value={existing.rating} readOnly />
          {existing.comment ? (
            <Typography variant="body2" color="text.secondary">
              {existing.comment}
            </Typography>
          ) : null}
          {privacyNote}
        </Stack>
      </Paper>
    );
  }

  if (thanks) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }} data-testid="guest-review">
        <Stack spacing={1}>
          <Alert severity="success" data-testid="guest-review-thanks" icon={false}>
            {t('guest.review.thanks')}
          </Alert>
          {privacyNote}
        </Stack>
      </Paper>
    );
  }

  if (!order.can_review) return null;

  const error =
    mutation.error && !(mutation.error instanceof ApiError && mutation.error.code === 'review_exists')
      ? mutation.error
      : null;

  return (
    <Paper variant="outlined" sx={{ p: 2 }} data-testid="guest-review">
      <Stack spacing={1.5}>
        <Typography variant="subtitle2">{t('guest.review.title')}</Typography>
        <Stars
          value={rating}
          hover={hover}
          onHover={setHover}
          onChange={setRating}
        />
        <TextField
          fullWidth
          multiline
          minRows={2}
          size="small"
          placeholder={t('guest.review.commentPlaceholder')}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          inputProps={{ 'data-testid': 'guest-review-comment' }}
        />
        {error ? <Alert severity="error">{errorMessage(error, t)}</Alert> : null}
        {privacyNote}
        <Button
          variant="contained"
          disabled={rating < 1 || mutation.isPending}
          onClick={() => mutation.mutate()}
          data-testid="guest-review-submit"
          sx={{ minHeight: 44 }}
        >
          {t('guest.review.submit')}
        </Button>
      </Stack>
    </Paper>
  );
}

function Stars({
  value,
  hover = 0,
  readOnly,
  onHover,
  onChange,
}: {
  value: number;
  hover?: number;
  readOnly?: boolean;
  onHover?: (n: number) => void;
  onChange?: (n: number) => void;
}) {
  const { t } = useTranslation();
  // Reference `.st` — a 44px rounded-square tile; `.st.on` fills a gold (secondary)
  // tint with a gold border. Gold maps to `secondary.main` per the token map.
  const tileSx = (on: boolean) => (theme: import('@mui/material/styles').Theme) => ({
    width: 44,
    height: 44,
    borderRadius: '12px',
    border: `1.5px solid ${on ? theme.palette.secondary.main : theme.palette.divider}`,
    bgcolor: on ? `color-mix(in srgb, ${theme.palette.secondary.main} 12%, transparent)` : 'transparent',
    color: on ? theme.palette.secondary.main : theme.palette.text.disabled,
  });
  return (
    <Box data-testid="guest-review-stars" sx={{ display: 'inline-flex', gap: '9px' }}>
      {[1, 2, 3, 4, 5].map((n) => {
        const on = (hover || value) >= n;
        const icon = on ? <StarIcon /> : <StarBorderIcon />;
        if (readOnly) {
          return (
            <Box
              key={n}
              aria-hidden
              sx={[tileSx(on), { display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }]}
            >
              {icon}
            </Box>
          );
        }
        return (
          <IconButton
            key={n}
            onClick={() => onChange?.(n)}
            onMouseEnter={() => onHover?.(n)}
            onMouseLeave={() => onHover?.(0)}
            data-testid={`guest-review-star-${n}`}
            aria-label={t('guest.review.starAria', { n })}
            sx={tileSx(on)}
          >
            {icon}
          </IconButton>
        );
      })}
    </Box>
  );
}
