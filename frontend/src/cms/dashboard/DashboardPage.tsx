import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { useTranslation } from 'react-i18next';

import { api } from '@/api/client';
import { QueryState } from '@/components/QueryState';
import { useBootstrap } from '@/hooks/useBootstrap';
import { formatMoney } from '@/utils/money';
import { pickTranslated } from '@/utils/translated';
import type { DashboardAttention, DashboardData } from './types';
import { attentionText } from './attention';

/**
 * ПУЛЬТ, А НЕ СПРАВКА.
 *
 * Экран показывал три плитки — заказов сегодня, заведений на витрине, всего
 * сервисов — и плоский список с «2 сотр. · 8 позиций». Два числа из трёх
 * меняются раз в месяц, когда открывают новый бар; «сотрудников и позиций» —
 * содержимое справочника. Ни одно из них не требовало действия, хотя подпись
 * обещала «что происходит сейчас».
 *
 * Управляющий открывает этот экран дважды в день и оба раза спрашивает про
 * РАЗНИЦУ: утром «что сломалось, пока меня не было», вечером «день лучше или
 * хуже вчерашнего». Отсюда порядок: сначала что горит, потом как идёт день,
 * потом где именно.
 *
 * ОДИН ЗАПРОС НА ВЕСЬ ЭКРАН. Три разошлись бы между собой: «требует внимания»
 * посчиталось бы до прихода заказа, а «сегодня» — после, и экран показал бы
 * просрочку, которой в числах дня уже нет.
 */

/** Пульт обязан быть свежим, но чаще минуты незачем: заказы идут на трекер. */
const REFRESH_MS = 60_000;

export function DashboardPage() {
  const { t } = useTranslation();

  const dashboard = useQuery({
    queryKey: ['cms', 'dashboard'],
    queryFn: () => api.get<DashboardData>('/cms/dashboard'),
    refetchInterval: REFRESH_MS,
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
        Всё — ВНУТРИ ветки с данными. Ноль печатается только тогда, когда сервер
        ответил и ответил нулём: «Заказов 0» на несостоявшемся ответе утверждает
        факт, которого никто не проверял.
      */}
      <QueryState query={dashboard} what={t('state.what.dashboard')}>
        {(data) => (
          <Stack spacing={4}>
            <Attention cards={data.attention} />
            <Today data={data} />
            {/* Управляющему единственного заведения разрез не нужен: оно и так
                весь экран, и список из одной строки только отнимает место. */}
            {data.venues.length > 1 ? <Venues data={data} /> : null}
          </Stack>
        )}
      </QueryState>
    </Box>
  );
}

/* ── Требует внимания ────────────────────────────────────────────────────── */

function Attention({ cards }: { cards: DashboardAttention[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  /*
    ВСЁ В ПОРЯДКЕ — ОДНА СТРОКА, А НЕ ПЯТЬ ЗЕЛЁНЫХ НУЛЕЙ.

    Пять карточек с нулями читаются как список проблем, у которых сейчас
    значение ноль, и глаз перестаёт их различать: когда одна из них станет
    единицей, её не заметят. Пусто — значит пусто, и сказать об этом надо
    коротко.
  */
  if (!cards.length) {
    return (
      <Alert
        severity="success"
        icon={<CheckCircleOutlineIcon />}
        data-testid="dashboard-all-clear"
      >
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {t('dashboard.allClear')}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {t('dashboard.allClearHint')}
        </Typography>
      </Alert>
    );
  }

  return (
    <Box data-testid="dashboard-attention">
      <Typography variant="h6" sx={{ mb: 1.5 }}>
        {t('dashboard.attention')}
      </Typography>
      <Stack spacing={1}>
        {cards.map((card) => {
          const text = attentionText(card, t);
          return (
            <Card
              key={`${card.code}-${card.resource ?? ''}`}
              variant="outlined"
              data-testid={`dashboard-attention-${card.code}`}
              sx={{
                p: 2,
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                flexWrap: 'wrap',
                borderColor: card.severity === 'error' ? 'error.main' : 'warning.main',
              }}
            >
              <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {text.title}
                </Typography>
                {/* Карточка объясняет, ЧЕМ это грозит. «Нет эскалации» без
                    этой строки годами висело меткой, которую никто не понимал. */}
                <Typography variant="caption" color="text.secondary">
                  {text.hint}
                </Typography>
              </Box>
              <Button
                size="small"
                variant="outlined"
                onClick={() => navigate(card.route)}
                data-testid={`dashboard-go-${card.code}`}
              >
                {t('dashboard.go')}
              </Button>
            </Card>
          );
        })}
      </Stack>
    </Box>
  );
}

/* ── Сегодня против вчера ────────────────────────────────────────────────── */

function Today({ data }: { data: DashboardData }) {
  const { t, i18n } = useTranslation();
  const { data: bootstrap } = useBootstrap();
  const today = data.today;

  const money = (minor: number | null) =>
    minor === null || minor === undefined || !bootstrap
      ? null
      : formatMoney(
          minor,
          bootstrap.hotel.currency,
          bootstrap.hotel.currency_minor_units,
          i18n.resolvedLanguage ?? 'ru',
        );

  return (
    <Box data-testid="dashboard-today">
      <Typography variant="h6" sx={{ mb: 1.5 }}>
        {t('dashboard.todayTitle')}
      </Typography>
      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
        <Metric
          label={t('dashboard.orders')}
          value={String(today.orders)}
          delta={today.orders_delta}
          testId="dashboard-orders"
        />
        <Metric
          label={t('dashboard.revenue')}
          value={money(today.revenue_minor)}
          delta={today.revenue_delta}
          testId="dashboard-revenue"
        />
        <Metric
          label={t('dashboard.rating')}
          value={today.avg_rating === null ? null : today.avg_rating.toFixed(1)}
          delta={today.rating_delta}
          testId="dashboard-rating"
        />
        {/*
          Гостей в приложении — ЖИВОЕ число, и дельты у него нет: сравнивать
          «сейчас» со «вчера в это же время» мы не умеем, а делать вид — хуже,
          чем не показывать. Управляющему заведением его не отдают вовсе
          (сессия к точке не привязана), и тогда сервер шлёт null.
        */}
        {today.live_guests !== null ? (
          <Metric
            label={t('dashboard.liveGuests')}
            value={String(today.live_guests)}
            testId="dashboard-live-guests"
          />
        ) : null}
        <Metric
          label={t('dashboard.speed')}
          /*
            МЕДИАНА, а не среднее: среди активных заказов всегда есть забытые,
            и одно такое значение утаскивает среднее в бессмыслицу. Среднее
            остаётся в Аналитике, где оно про закрытый период.
          */
          value={today.median_minutes === null ? null : t('tracker.age.minutes', { count: today.median_minutes })}
          testId="dashboard-speed"
        />
        <Metric
          label={t('dashboard.doneToday')}
          value={String(today.done)}
          testId="dashboard-done"
        />
      </Stack>
    </Box>
  );
}

function Metric({
  label,
  value,
  delta,
  testId,
}: {
  label: string;
  /** `null` — данных нет. Печатается ПРОЧЕРК: ноль утверждал бы факт. */
  value: string | null;
  delta?: number | null;
  testId: string;
}) {
  const { t } = useTranslation();
  return (
    <Card variant="outlined" sx={{ p: 2, minWidth: 168 }} data-testid={testId}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {label}
      </Typography>
      <Typography variant="h4" sx={{ fontWeight: 600 }}>
        {value ?? t('dashboard.noData')}
      </Typography>
      <Delta value={delta} />
    </Card>
  );
}

/**
 * Дельта ко вчерашнему дню. Ради неё экран и существует: «63 заказа» не говорит
 * ничего, «63 против 35» говорит всё.
 *
 * Ноль-дельта — это «столько же», и её надо показать: молчание в этом месте
 * читается как «сравнить не с чем», а это другое.
 */
function Delta({ value }: { value?: number | null }) {
  const { t } = useTranslation();
  if (value === null || value === undefined) {
    return (
      <Typography variant="caption" color="text.disabled">
        {t('dashboard.noDelta')}
      </Typography>
    );
  }
  const percent = Math.round(value * 100);
  const up = percent > 0;
  const flat = percent === 0;
  return (
    <Stack direction="row" alignItems="center" spacing={0.25} data-testid="dashboard-delta">
      {flat ? null : up ? (
        <ArrowUpwardIcon sx={{ fontSize: 14, color: 'success.main' }} />
      ) : (
        <ArrowDownwardIcon sx={{ fontSize: 14, color: 'error.main' }} />
      )}
      <Typography
        variant="caption"
        color={flat ? 'text.secondary' : up ? 'success.main' : 'error.main'}
      >
        {flat ? '0%' : `${percent > 0 ? '+' : ''}${percent}%`}
      </Typography>
      <Typography variant="caption" color="text.disabled">
        {t('dashboard.vsYesterday')}
      </Typography>
    </Stack>
  );
}

/* ── По заведениям ───────────────────────────────────────────────────────── */

function Venues({ data }: { data: DashboardData }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const language = i18n.resolvedLanguage ?? 'ru';

  return (
    <Box data-testid="dashboard-venues">
      <Typography variant="h6" sx={{ mb: 1.5 }}>
        {t('dashboard.venuesTitle')}
      </Typography>
      <Stack spacing={1}>
        {data.venues.map((venue) => (
          <Card
            key={venue.code}
            variant="outlined"
            data-testid={`dashboard-venue-${venue.code}`}
            onClick={() => navigate(venue.route)}
            sx={{
              p: 2,
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              flexWrap: 'wrap',
              cursor: 'pointer',
              borderColor: venue.overdue ? 'error.main' : 'divider',
            }}
          >
            <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 0 }} noWrap>
              {pickTranslated(venue.title, language, 'ru') || venue.code}
            </Typography>
            <Box sx={{ flexGrow: 1 }} />
            {/*
              Строка отвечает «как там дела», а не «сколько там строк меню».
              Справочные «2 сотр. · 8 позиций» уехали в карточку сервиса, где их
              и правят.
            */}
            <Typography variant="caption" color="text.secondary">
              {t('dashboard.inWork')}: {venue.in_work} · {t('dashboard.orders')}: {venue.new}
            </Typography>
            {venue.overdue ? (
              <Typography variant="caption" color="error.main" sx={{ fontWeight: 700 }}>
                {t('dashboard.card.overdue', { count: venue.overdue })}
              </Typography>
            ) : null}
            {venue.median_minutes !== null ? (
              <Typography variant="caption" color="text.secondary">
                {t('dashboard.speed')}: {t('tracker.age.minutes', { count: venue.median_minutes })}
              </Typography>
            ) : null}
          </Card>
        ))}
      </Stack>
    </Box>
  );
}
