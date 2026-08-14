import { useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { api } from '@/api/client';
import { QueryState } from '@/components/QueryState';
import { fetchServices } from '@/cms/services/api';

/**
 * Дашборд — «что сейчас», первый экран администратора.
 *
 * Намеренно скромный: это пульт, а не отчёт. «За период» живёт в Аналитике, и
 * дублировать её здесь значило бы дать два разных ответа на один вопрос.
 * Показываем то, на что можно среагировать сегодня: сколько задач в работе по
 * заведениям и что просрочено.
 */
interface SummaryResponse {
  current: { orders: number; gross_minor: number; sessions: number | null };
}

export function DashboardPage() {
  const { t } = useTranslation();

  const services = useQuery({ queryKey: ['cms', 'services'], queryFn: fetchServices });
  const summary = useQuery({
    queryKey: ['cms', 'dashboard', 'today'],
    queryFn: () => api.get<SummaryResponse>('/cms/analytics/summary?preset=today'),
    // Пульт обязан быть свежим, но опрашивать чаще минуты незачем: заказы
    // приходят на трекер, а не сюда.
    refetchInterval: 60_000,
  });

  return (
    <Box sx={{ p: 3 }} data-testid="cms-dashboard">
      <Typography variant="h5" sx={{ mb: 0.5 }}>
        {t('dashboard.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {t('dashboard.subtitle')}
      </Typography>

      {/*
        Плитки — ВНУТРИ ветки с данными, и это главное в этой правке.
        Раньше на отказе рисовалось «Заведений на витрине 0» и «Всего сервисов
        0»: `services.data ?? []` превращал несостоявшийся ответ в пустой
        список, а пустой список — в честный на вид ноль. Спиннер хотя бы
        говорит «жду»; ноль утверждает факт, которого никто не проверял, и
        управляющий видит отель, у которого ничего нет.

        Правило простое: ноль печатается только тогда, когда сервер ответил и
        ответил нулём.
      */}
      <QueryState query={services} what={t('state.what.dashboard')}>
        {(list) => {
          const guestFacing = list.filter((service) => service.is_guest_facing);
          return (
            <>
      <Stack direction="row" spacing={2} sx={{ mb: 3 }} flexWrap="wrap" useFlexGap>
        <StatCard
          label={t('dashboard.ordersToday')}
          // Своя загрузка у сводки: заказы приходят отдельным запросом, и
          // прочерк здесь означает «этой цифры пока нет», а не ноль заказов.
          value={summary.data ? String(summary.data.current.orders) : '—'}
          testId="dashboard-orders-today"
        />
        <StatCard
          label={t('dashboard.venues')}
          value={String(guestFacing.length)}
          testId="dashboard-venues"
        />
        <StatCard
          label={t('dashboard.services')}
          value={String(list.length)}
          testId="dashboard-services"
        />
      </Stack>

      <Typography variant="h6" sx={{ mb: 1.5 }}>
        {t('dashboard.byService')}
      </Typography>
      <Stack spacing={1}>
        {list.map((service) => (
          <Card
            key={service.id}
            variant="outlined"
            sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}
            data-testid={`dashboard-service-${service.code}`}
          >
            <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 0 }} noWrap>
              {service.public_name.ru ?? service.code}
            </Typography>
            <Chip size="small" variant="outlined" label={t(`services.types.${service.type}`)} />
            <Box sx={{ flexGrow: 1 }} />
            <Typography variant="caption" color="text.secondary">
              {t('dashboard.staffAndItems', {
                staff: service.staff_count,
                items: service.item_count,
              })}
            </Typography>
            {!service.has_escalation ? (
              // Отсутствие эскалации — не мелочь: невзятая заявка не всплывёт
              // ни у кого, и отель узнает о ней от гостя.
              <Chip size="small" color="warning" label={t('dashboard.noEscalation')} />
            ) : null}
          </Card>
        ))}
      </Stack>
            </>
          );
        }}
      </QueryState>
    </Box>
  );
}

function StatCard({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId: string;
}) {
  return (
    <Card variant="outlined" sx={{ p: 2, minWidth: 180 }} data-testid={testId}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h4" sx={{ fontWeight: 600 }}>
        {value}
      </Typography>
    </Card>
  );
}
