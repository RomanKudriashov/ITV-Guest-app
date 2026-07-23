import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ArrowDropUpIcon from '@mui/icons-material/ArrowDropUp';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';

import type { SummaryMetrics, SummaryResponse } from '@/api/analyticsTypes';
import { useMetricFormatters, type MetricFormat } from './format';

interface MetricSpec {
  /** Testid segment: `analytics-summary-card-<id>`. */
  id: string;
  metric: keyof SummaryMetrics;
  format: MetricFormat;
  /** A rise is a good thing (green) — false means lower is better (red). */
  higherIsBetter: boolean;
}

const METRICS: MetricSpec[] = [
  { id: 'orders', metric: 'orders', format: 'count', higherIsBetter: true },
  // Заглавная «Выручка» — ПОЛНАЯ сумма (gross), а не только позиции: после
  // шага 7 revenue_minor стало subtotal'ом, полная сумма — gross_minor.
  // Разложение показываем вторично строкой под цифрой (см. breakdown ниже).
  { id: 'revenue', metric: 'gross_minor', format: 'money', higherIsBetter: true },
  { id: 'avg_check', metric: 'avg_check_minor', format: 'money', higherIsBetter: true },
  { id: 'items_per_order', metric: 'items_per_order', format: 'decimal', higherIsBetter: true },
  { id: 'completed_rate', metric: 'completed_rate', format: 'percent', higherIsBetter: true },
  { id: 'cancel_rate', metric: 'cancel_rate', format: 'percent', higherIsBetter: false },
  { id: 'avg_reaction', metric: 'avg_reaction_seconds', format: 'duration', higherIsBetter: false },
  { id: 'avg_fulfil', metric: 'avg_fulfil_seconds', format: 'duration', higherIsBetter: false },
  { id: 'avg_rating', metric: 'avg_rating', format: 'rating', higherIsBetter: true },
  { id: 'sessions', metric: 'sessions', format: 'count', higherIsBetter: true },
  { id: 'conversion', metric: 'conversion', format: 'percent', higherIsBetter: true },
];

export function SummaryCards({
  data,
  isLoading,
  compare,
}: {
  data: SummaryResponse | undefined;
  isLoading: boolean;
  compare: boolean;
}) {
  const { t } = useTranslation();
  const fmt = useMetricFormatters();

  return (
    <Box
      data-testid="analytics-summary"
      sx={{
        display: 'grid',
        gap: 1.5,
        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
      }}
    >
      {METRICS.map((spec) => {
        const current = data?.current?.[spec.metric];
        const delta = data?.delta?.[spec.metric];
        return (
          <Card
            key={spec.id}
            variant="outlined"
            sx={{ borderColor: 'divider' }}
            data-testid={`analytics-summary-card-${spec.id}`}
          >
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Typography variant="caption" color="text.secondary">
                {t(`analytics.metrics.${spec.id}`)}
              </Typography>
              {isLoading ? (
                <Skeleton variant="text" width="70%" height={32} />
              ) : (
                <Typography
                  variant="h6"
                  sx={{ mt: 0.25 }}
                  data-testid={`analytics-summary-value-${spec.id}`}
                >
                  {current === undefined ? '—' : fmt.value(current, spec.format)}
                </Typography>
              )}
              {compare && !isLoading ? (
                <DeltaBadge value={delta} higherIsBetter={spec.higherIsBetter} />
              ) : null}
              {spec.id === 'revenue' && !isLoading && data?.current ? (
                <RevenueBreakdown current={data.current} fmt={fmt} t={t} />
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </Box>
  );
}

function DeltaBadge({
  value,
  higherIsBetter,
}: {
  value: number | undefined;
  higherIsBetter: boolean;
}) {
  const { t } = useTranslation();
  const fmt = useMetricFormatters();

  if (value === undefined) {
    return (
      <Typography variant="caption" color="text.secondary">
        {t('analytics.compare.noPrevious')}
      </Typography>
    );
  }

  const isUp = value > 0;
  const isFlat = value === 0;
  const good = isFlat ? undefined : isUp === higherIsBetter;
  const color = good === undefined ? 'text.secondary' : good ? 'success.main' : 'error.main';

  return (
    <Stack direction="row" alignItems="center" spacing={0.25} sx={{ mt: 0.5, color }}>
      {isFlat ? null : isUp ? (
        <ArrowDropUpIcon fontSize="small" />
      ) : (
        <ArrowDropDownIcon fontSize="small" />
      )}
      <Typography variant="caption" sx={{ color: 'inherit', fontWeight: 500 }}>
        {fmt.signedPercent(value)}
      </Typography>
    </Stack>
  );
}

/**
 * Вторичное разложение выручки под заглавной цифрой (позиции + начисления).
 * Показываем только ненулевые компоненты; полноценный UI разложения — шаг 5.
 */
function RevenueBreakdown({
  current,
  fmt,
  t,
}: {
  current: SummaryMetrics;
  fmt: ReturnType<typeof useMetricFormatters>;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const parts: Array<[string, number]> = [
    ['positions', current.revenue_minor ?? 0],
    ['fee', current.service_fee_minor ?? 0],
    ['delivery', current.delivery_minor ?? 0],
    ['tax', current.tax_minor ?? 0],
    ['tip', current.tip_minor ?? 0],
  ];
  // Разложение имеет смысл, только когда есть начисления (gross ≠ позиции).
  const hasCharges = parts.slice(1).some(([, value]) => value > 0);
  if (!hasCharges) return null;

  return (
    <Typography
      variant="caption"
      color="text.secondary"
      data-testid="analytics-revenue-breakdown"
      sx={{ display: 'block', mt: 0.5, lineHeight: 1.5 }}
    >
      {parts
        .filter(([, value]) => value > 0)
        .map(([key, value]) => `${t(`analytics.revenue.${key}`)} ${fmt.value(value, 'money')}`)
        .join(' · ')}
    </Typography>
  );
}
