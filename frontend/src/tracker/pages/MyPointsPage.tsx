import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router-dom';

import { useMyPoints } from '../hooks/useTrackerQueries';
import type { MyPoint } from '../api/types';

/**
 * «МОИ ТОЧКИ» (партия 49, решение тек-лида 9а).
 *
 * Человеку на нескольких точках нужен ответ «где сейчас горит», а не доска
 * каждой по очереди. Строка на точку — новые, в работе, просрочено, сделано за
 * смену, медиана до принятия; касание ведёт на доску этой точки.
 *
 * Скоуп — тот же, что у трекера: назначенные точки, администратору — все
 * активные. Числа — та же сводка смены, что плитка на доске. Обновление —
 * опросом раз в 30 секунд, без сокетов.
 *
 * Одна точка — экрана нет: выбирать не из чего, и человек сразу на доске.
 */
export function MyPointsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const query = useMyPoints();
  const points = query.data?.points;

  if (points && points.length < 2) return <Navigate to="/tracker" replace />;

  return (
    <Box data-testid="my-points" sx={{ px: { xs: 2, sm: 3 }, py: 2, maxWidth: 960, mx: 'auto' }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <Button size="small" startIcon={<ArrowBackIcon />} onClick={() => navigate('/tracker')}>
          {t('tracker.myPoints.toBoard')}
        </Button>
        <Typography variant="h6" component="h1" sx={{ flexGrow: 1 }}>
          {t('tracker.myPoints.title')}
        </Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('tracker.myPoints.caption')}
      </Typography>

      {query.isError && !points && (
        <Alert severity="error" data-testid="my-points-error">
          {t('tracker.myPoints.error')}
        </Alert>
      )}
      {!points && !query.isError && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      <Stack spacing={1.5}>
        {points?.map((point) => (
          <PointRow key={point.code} point={point} onOpen={() => navigate(`/tracker?point=${point.code}`)} />
        ))}
      </Stack>
    </Box>
  );
}

function PointRow({ point, onOpen }: { point: MyPoint; onOpen: () => void }) {
  const { t } = useTranslation();
  const { summary } = point;
  const median = summary.median_accept_minutes;
  const cells: Array<{ key: string; label: string; value: string; alarm?: boolean }> = [
    { key: 'new', label: t('tracker.myPoints.new'), value: String(summary.new) },
    { key: 'in_work', label: t('tracker.myPoints.inWork'), value: String(summary.in_work) },
    {
      key: 'overdue',
      label: t('tracker.myPoints.overdue'),
      value: String(summary.overdue),
      alarm: summary.overdue > 0,
    },
    { key: 'done', label: t('tracker.myPoints.done'), value: String(summary.done) },
    {
      key: 'median_accept',
      label: t('tracker.myPoints.medianAccept'),
      value: median === null ? '—' : t('tracker.myPoints.minutes', { value: median }),
    },
  ];

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
      <ButtonBase
        onClick={onOpen}
        data-testid={`my-points-row-${point.code}`}
        sx={{ width: '100%', display: 'block', textAlign: 'start', p: 2, minHeight: 44 }}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1, overflowWrap: 'anywhere' }}>
          {point.title}
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(5, minmax(0, 1fr))' },
            gap: 1,
          }}
        >
          {cells.map((cell) => (
            <Box key={cell.key} data-testid={`my-points-${point.code}-${cell.key}`}>
              <Typography variant="caption" color="text.secondary" component="div">
                {cell.label}
              </Typography>
              <Typography
                variant="h6"
                component="div"
                color={cell.alarm ? 'error.main' : 'text.primary'}
                sx={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {cell.value}
              </Typography>
            </Box>
          ))}
        </Box>
      </ButtonBase>
    </Paper>
  );
}
