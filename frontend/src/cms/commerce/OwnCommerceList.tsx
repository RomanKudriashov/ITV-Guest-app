import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import {
  fetchCommerceOverrides,
  resetCommerceOverrides,
  type CommerceOverrideField,
} from '@/api/cms';
import { useToast } from '@/components/ToastProvider';

/**
 * «У кого из заведений своя коммерция» — СПИСКОМ.
 *
 * Раньше этот ответ собирался обходом карточек по одной, и собирался неверно:
 * заглянув в шесть заведений из девяти, человек уходил с уверенностью, что
 * везде одинаково. Это деньги — расхождение в сборе есть расхождение в счёте
 * гостя, и узнают о нём из жалобы.
 *
 * ДВА СОСТОЯНИЯ, И ВТОРОЕ ВАЖНЕЕ, ЧЕМ КАЖЕТСЯ.
 *
 *   «своё»       — значение отличается от отельного;
 *   «закреплено» — значение задано и СОВПАДАЕТ с отельным.
 *
 * Второе выглядит как «всё в порядке» и им не является: закреплённое значение
 * за отелем больше не идёт. Завтра отель поднимет сбор, у этих заведений он
 * останется прежним, и причину будут искать долго. Прятать такую строку
 * значило бы прятать ровно тот ответ, ради которого экран открывают.
 *
 * Возврат ставит НАСЛЕДОВАНИЕ, а не копию отельного значения: скопированное
 * значение — тот же оверрайд под другим именем.
 */
export function OwnCommerceList() {
  const { t } = useTranslation();
  const toast = useToast();
  const client = useQueryClient();

  const overrides = useQuery({
    queryKey: ['cms', 'commerce', 'overrides'],
    queryFn: fetchCommerceOverrides,
  });

  const reset = useMutation({
    mutationFn: (serviceId: string) => resetCommerceOverrides([serviceId]),
    onSuccess: () => {
      toast.show(t('commerce.own.resetDone'));
      void client.invalidateQueries({ queryKey: ['cms', 'commerce'] });
    },
  });

  if (!overrides.data) return null;
  const { services, with_own: withOwn, total_services: total } = overrides.data;

  return (
    <Card
      variant="outlined"
      data-testid="cms-commerce-overrides"
      sx={{ maxWidth: 720, borderColor: 'divider', mt: 3 }}
    >
      <CardContent>
        <Typography variant="subtitle1">{t('commerce.own.title')}</Typography>
        <Typography variant="caption" color="text.secondary">
          {t('commerce.own.subtitle', { count: withOwn, total })}
        </Typography>

        {services.length === 0 ? (
          <Typography
            variant="body2"
            color="text.secondary"
            data-testid="cms-commerce-overrides-empty"
            sx={{ mt: 2 }}
          >
            {t('commerce.own.empty')}
          </Typography>
        ) : (
          <Stack spacing={2} sx={{ mt: 2 }}>
            {services.map((row) => (
              <Box
                key={row.service_id}
                data-testid={`cms-commerce-override-${row.code}`}
                sx={{
                  display: 'flex',
                  gap: 2,
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={600}>
                    {Object.values(row.name)[0] ?? row.code}
                  </Typography>
                  <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                    {row.fields.map((field) => (
                      <FieldLine key={field.field} field={field} />
                    ))}
                  </Stack>
                </Box>
                <Button
                  size="small"
                  data-testid={`cms-commerce-override-reset-${row.code}`}
                  onClick={() => reset.mutate(row.service_id)}
                  disabled={reset.isPending}
                  sx={{ flexShrink: 0 }}
                >
                  {t('commerce.own.reset')}
                </Button>
              </Box>
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

function FieldLine({ field }: { field: CommerceOverrideField }) {
  const { t } = useTranslation();
  const pinned = field.state === 'pinned';
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
      <Typography variant="caption" color="text.secondary">
        {field.label}
      </Typography>
      <Typography variant="caption">{format(field.own)}</Typography>
      <Typography variant="caption" color="text.disabled">
        {t('commerce.own.atHotel', { value: format(field.hotel) })}
      </Typography>
      <Chip
        size="small"
        variant="outlined"
        // Закреплённое — не тревога, но и не «как у отеля»: оно за отелем не
        // пойдёт. Нейтральный тон и отдельное слово, а не общая метка «своё».
        color={pinned ? 'default' : 'warning'}
        label={t(pinned ? 'commerce.own.pinned' : 'commerce.own.changed')}
      />
    </Stack>
  );
}

function format(value: number | number[] | null): string {
  if (value === null || value === undefined) return '—';
  return Array.isArray(value) ? value.join(' / ') : String(value);
}
