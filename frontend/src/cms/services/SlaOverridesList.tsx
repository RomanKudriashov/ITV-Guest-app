import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { fetchSlaOverrides, resetSlaOverrides } from '@/api/cms';
import { ApiError } from '@/api/client';
import { useToast } from '@/components/ToastProvider';

/**
 * «Где порог просрочки переопределён».
 *
 * Наследование порога работало и без этого экрана: пусто — умолчание вида
 * работы, заполнено — выбор оператора. Не работал ВИД СВЕРХУ: вопрос «где у нас
 * вообще переопределено» требовал открыть все точки по очереди, и ответ на него
 * зависел от терпения спрашивающего.
 *
 * Почему это не мелочь: порог красит заказы просрочкой, просрочка поднимает
 * эскалацию, эскалация будит старшего. Точка с порогом в пять минут,
 * поставленным когда-то на время, разбудит его сегодня ночью — и никто не
 * вспомнит, что этот порог там стоит.
 *
 * Показываются ВСЕ точки, а не только переопределённые: без знаменателя число
 * «переопределено 3» ни о чём не говорит.
 */
export function SlaOverridesList() {
  const { t } = useTranslation();
  const toast = useToast();
  const client = useQueryClient();

  const data = useQuery({ queryKey: ['cms', 'sla', 'overrides'], queryFn: fetchSlaOverrides });
  const reset = useMutation({
    mutationFn: (pointId: string) => resetSlaOverrides([pointId]),
    // Отказ обязан быть виден: молчаливая неудача здесь выглядит как «нажал и
    // ничего не произошло», и человек нажимает ещё раз.
    onError: (error) =>
      toast.show(error instanceof ApiError ? error.detail : t('errors.generic'), 'error'),
    onSuccess: () => {
      toast.show(t('services.sla.resetDone'), 'success');
      void client.invalidateQueries({ queryKey: ['cms', 'sla'] });
    },
  });

  if (!data.data) return null;
  const { points, overridden, total_points: total } = data.data;

  return (
    <Card
      variant="outlined"
      data-testid="cms-sla-overrides"
      sx={{ borderColor: 'divider', mt: 3 }}
    >
      <CardContent>
        <Typography variant="subtitle1">{t('services.sla.title')}</Typography>
        <Typography variant="caption" color="text.secondary">
          {t('services.sla.subtitle', { count: overridden, total })}
        </Typography>

        <Stack spacing={1.5} sx={{ mt: 2 }}>
          {points.map((row) => {
            const own = row.state !== 'inherited';
            return (
              <Box
                key={row.point_id}
                data-testid={`cms-sla-row-${row.code}`}
                sx={{ display: 'flex', gap: 2, alignItems: 'center', justifyContent: 'space-between' }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2">
                    {Object.values(row.title)[0] ?? row.code}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {own
                      ? t('services.sla.own', {
                          minutes: row.own_minutes,
                          fallback: row.default_minutes,
                        })
                      : t('services.sla.inherited', { minutes: row.default_minutes })}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
                  <Chip
                    size="small"
                    variant="outlined"
                    // «Закреплено» — порог задан руками и совпал с умолчанием.
                    // За умолчанием он больше не идёт, и молчать об этом нельзя.
                    color={row.state === 'changed' ? 'warning' : 'default'}
                    label={t(`services.sla.state.${row.state}`)}
                  />
                  {own ? (
                    <Button
                      size="small"
                      data-testid={`cms-sla-reset-${row.code}`}
                      onClick={() => reset.mutate(row.point_id)}
                      disabled={reset.isPending}
                    >
                      {t('services.sla.reset')}
                    </Button>
                  ) : null}
                </Stack>
              </Box>
            );
          })}
        </Stack>
      </CardContent>
    </Card>
  );
}
