import { useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { accent, ink, panelSx, state, surface } from '../adminTokens';
import { QueryState } from '../QueryState';
import { getOverview, type OverviewHealth } from '../adminClient';

/**
 * Сводка по платформе — первое, что видит владелец.
 *
 * Порядок блоков отвечает на вопросы в том порядке, в каком их задают: «сколько
 * у меня отелей и что с ними», «сколько сегодня заказали», «растём ли»,
 * «что сломалось». Здоровье системы стоит последним не по важности, а потому
 * что при исправной платформе там одна строка «норма»; ставить её первой значит
 * каждый день начинать с пустого блока.
 */
export function OverviewPage() {
  const { t, i18n } = useTranslation();
  const overview = useQuery({ queryKey: ['admin', 'overview'], queryFn: getOverview });

  if (overview.isPending || overview.isError || overview.data === undefined) {
    // Загрузка и отказ — обе ветки общей механики: сводка целиком зависит от
    // одного запроса, показывать её каркас без чисел незачем.
    return (
      <QueryState query={overview} what={t('admin.state.what.overview')}>
        {() => null}
      </QueryState>
    );
  }

  const data = overview.data;
  // Оборот показываем ПО ВАЛЮТАМ: у отелей платформы они могут различаться, и
  // одна сумма поверх разных минимальных единиц была бы числом, которое ничего
  // не значит, но выглядит как деньги.
  const money =
    data.gross_today.length === 0
      ? '—'
      : data.gross_today
          .map((entry) =>
            new Intl.NumberFormat(i18n.language, {
              style: 'currency',
              currency: entry.currency,
              maximumFractionDigits: 0,
            }).format(entry.minor / 100),
          )
          .join(' · ');
  const peak = Math.max(1, ...data.growth.map((point) => point.hotels));

  return (
    <Box data-testid="admin-overview">
      <Typography sx={{ fontSize: 24, fontWeight: 800, letterSpacing: '-.02em' }}>
        {t('admin.overview.title')}
      </Typography>
      <Typography sx={{ color: ink.low, fontSize: 13, mt: 0.5 }}>
        {t('admin.overview.subtitle', { count: data.hotels.total })}
      </Typography>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(4,1fr)' },
          gap: 1.75,
          mt: 2.5,
        }}
      >
        <Kpi
          label={t('admin.overview.kpi.hotels')}
          value={data.hotels.total}
          hint={t('admin.overview.kpi.hotelsHint', {
            active: data.hotels.active,
            trial: data.hotels.trial,
            disabled: data.hotels.disabled,
          })}
          testId="admin-kpi-hotels"
        />
        <Kpi
          label={t('admin.overview.kpi.orders')}
          value={data.orders_today}
          hint={t('admin.overview.kpi.ordersHint')}
          testId="admin-kpi-orders"
        />
        <Kpi
          label={t('admin.overview.kpi.gross')}
          value={money}
          hint={t('admin.overview.kpi.grossHint')}
          testId="admin-kpi-gross"
        />
        <Kpi
          label={t('admin.overview.kpi.sessions')}
          value={data.live_sessions}
          hint={t('admin.overview.kpi.sessionsHint')}
          testId="admin-kpi-sessions"
        />
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: '1.4fr 1fr' },
          gap: 1.75,
          mt: 1.75,
        }}
      >
        <Box sx={panelSx} data-testid="admin-growth">
          <Typography sx={{ fontSize: 14, fontWeight: 700, mb: 1.5 }}>
            {t('admin.overview.growth')}
          </Typography>
          <Box sx={{ display: 'flex', gap: '3px', height: 90, alignItems: 'flex-end' }}>
            {data.growth.map((point) => (
              <Box
                key={point.month}
                title={`${point.month}: ${point.hotels}`}
                sx={{
                  flex: 1,
                  minHeight: 3,
                  height: `${Math.round((point.hotels / peak) * 100)}%`,
                  background: `linear-gradient(180deg,${accent.light},${accent.main})`,
                  borderRadius: '4px 4px 0 0',
                }}
              />
            ))}
          </Box>
        </Box>

        <Box sx={panelSx} data-testid="admin-health">
          <Typography sx={{ fontSize: 14, fontWeight: 700, mb: 1 }}>
            {t('admin.overview.health')}
          </Typography>
          {data.health.map((signal, index) => (
            <HealthRow key={`${signal.code}-${index}`} signal={signal} />
          ))}
        </Box>
      </Box>
    </Box>
  );
}

function Kpi({
  label,
  value,
  hint,
  testId,
}: {
  label: string;
  value: number | string;
  hint: string;
  testId: string;
}) {
  return (
    <Box sx={panelSx} data-testid={testId}>
      <Typography sx={{ fontSize: 11, color: ink.low, fontWeight: 600 }}>{label}</Typography>
      <Typography sx={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.02em', mt: 0.75 }}>
        {value}
      </Typography>
      <Typography sx={{ fontSize: 11, mt: 0.6, color: ink.mid }}>{hint}</Typography>
    </Box>
  );
}

const TONE: Record<OverviewHealth['level'], string> = {
  ok: state.ok,
  warn: state.warn,
  bad: state.bad,
};

function HealthRow({ signal }: { signal: OverviewHealth }) {
  const { t } = useTranslation();
  return (
    <Box
      data-testid={`admin-health-${signal.code}`}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.1,
        py: 1.1,
        fontSize: 12.5,
        color: ink.mid,
        borderBottom: `1px solid ${surface.hair}`,
      }}
    >
      <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: TONE[signal.level], flex: 'none' }} />
      {t(`admin.health.${signal.code}`, {
        count: signal.count ?? 0,
        hotel: signal.hotel ?? '',
        days: signal.days ?? 0,
        defaultValue: signal.code,
      })}
    </Box>
  );
}
