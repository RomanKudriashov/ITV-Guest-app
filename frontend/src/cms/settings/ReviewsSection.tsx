import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { api } from '@/api/client';
import { QueryState } from '@/components/QueryState';

/**
 * Сбор отзывов: включён ли и что считать низкой оценкой.
 *
 * МЕСТО ЗДЕСЬ, А НЕ В КОНСОЛИ ПЛАТФОРМЫ. Ручка `PATCH /cms/review-settings`
 * была написана давно и всё это время не имела ни одного экрана: продукт поля
 * читал (`reviews/services.py` решает, предлагать ли оценку, и кого дёргать
 * при низкой), а задать их не мог никто.
 *
 * Решение о том, спрашивать ли гостя об оценке и с какой звезды звать
 * менеджера, принимает отель, а не оператор платформы: это часть его сервиса,
 * а не свойство арендатора. Поэтому — в настройках отеля, рядом с витриной и
 * поиском, а не в карточке отеля у платформы.
 */
interface ReviewSettings {
  enabled: boolean;
  low_rating_threshold: number;
}

export function ReviewsSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const settings = useQuery({
    queryKey: ['cms', 'review-settings'],
    queryFn: () => api.get<ReviewSettings>('/cms/review-settings'),
  });

  const save = useMutation({
    mutationFn: (patch: Partial<ReviewSettings>) =>
      api.patch<ReviewSettings>('/cms/review-settings', patch),
    onSuccess: (updated) => {
      setError(null);
      queryClient.setQueryData(['cms', 'review-settings'], updated);
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : t('settings.reviews.saveFailed')),
  });

  return (
    <Box data-testid="settings-reviews">
      <Typography variant="h6" sx={{ mb: 1 }}>
        {t('settings.reviews.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('settings.reviews.subtitle')}
      </Typography>

      <QueryState query={settings} what={t('state.what.reviewSettings')}>
        {(data) => (
          <Stack spacing={2} sx={{ maxWidth: 520 }}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Switch
                checked={data.enabled}
                onChange={(event) => save.mutate({ enabled: event.target.checked })}
                inputProps={
                  { 'data-testid': 'reviews-enabled' } as unknown as Record<string, string>
                }
              />
              <Typography variant="body2">
                {data.enabled ? t('settings.reviews.on') : t('settings.reviews.off')}
              </Typography>
            </Stack>

            <TextField
              select
              size="small"
              label={t('settings.reviews.threshold')}
              value={String(data.low_rating_threshold)}
              // Порог имеет смысл только при включённом сборе: выключенный
              // отзыв не с чем сравнивать.
              disabled={!data.enabled || save.isPending}
              onChange={(event) => save.mutate({ low_rating_threshold: Number(event.target.value) })}
              SelectProps={{ inputProps: { 'data-testid': 'reviews-threshold' } }}
              helperText={t('settings.reviews.thresholdHint')}
              sx={{ maxWidth: 320 }}
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <MenuItem key={value} value={String(value)}>
                  {value}
                </MenuItem>
              ))}
            </TextField>

            {error ? (
              <Alert severity="error" data-testid="reviews-error" onClose={() => setError(null)}>
                {error}
              </Alert>
            ) : null}
          </Stack>
        )}
      </QueryState>
    </Box>
  );
}
