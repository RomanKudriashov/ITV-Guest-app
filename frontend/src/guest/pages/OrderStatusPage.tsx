import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Container from '@mui/material/Container';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { NotificationsOptIn } from '../notifications/NotificationsOptIn';
import { useOrderStatusNotifications } from '../notifications/useOrderStatusNotifications';
import { ItemThumb } from '../components/ItemMeta';
import { OrderFieldValues } from '../components/OrderFieldValues';
import { OrderSlot } from '../components/OrderSlot';
import { OrderTimeline } from '../components/OrderTimeline';
import { ReviewBlock } from '../components/ReviewBlock';
import ScheduleIcon from '@mui/icons-material/Schedule';

import { cancelOrder } from '../api/guest';
import { guestKeys } from '../api/queryKeys';
import { errorMessage } from '../errors';
import { useGuestLanguage, useGuestOrder } from '../hooks/useGuestQueries';
import { useOrderLive } from '../hooks/useOrderLive';
import { useMoney } from '../hooks/useMoney';
import { serveByTime } from '../utils/serveBy';
import type { GuestOrder } from '../api/types';

export function OrderStatusPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { formatOptional } = useMoney();
  const language = useGuestLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const justPlaced = searchParams.get('placed') === '1';

  /*
    ДВА РАЗНЫХ ОПРОСА, И ЭТО НЕ ИЗБЫТОЧНОСТЬ.

    Частый (15 с) — когда сокет заведомо лежит: гость видит «Нет связи», и
    статус всё равно должен двигаться.

    Редкий (45 с) — когда сокет ЖИВ. Он закрывает случай, для которого раньше
    не было ничего: соединение здорово, а одно сообщение до клиента не дошло.
    Экран оставался неверным до перезагрузки — гость не узнавал, что заказ уже
    привезли, и никакой признак на это не намекал. Опрос по состоянию
    соединения такое не ловит по определению: соединение-то в порядке.

    Мигания при этом нет: сокет и опрос кладут в кэш ОДИН И ТОТ ЖЕ снимок
    заказа, а react-query не перерисовывает подписчиков, если данные совпали
    по значению. Постоянным опросом это тоже не становится — раз в 45 секунд
    против одного кадра на каждое изменение.
  */
  const SOCKET_DOWN_POLL_MS = 15_000;
  const SAFETY_NET_POLL_MS = 45_000;

  const [pollMs, setPollMs] = useState<number | undefined>(undefined);
  const { data: order, isLoading, error, refetch } = useGuestOrder(id, pollMs);
  // Live status: snapshots land straight in the query cache (see useOrderLive).
  const live = useOrderLive(id, Boolean(order) && !order?.status.is_terminal);
  // Уведомление на смену статуса. Источник — тот же снимок из сокета, своего
  // канала не заводим.
  useOrderStatusNotifications(order);

  useEffect(() => {
    // Терминальный статус опрос прекращает: дальше меняться нечему.
    const running = Boolean(order) && !order?.status.is_terminal;
    if (!running) {
      setPollMs(undefined);
      return;
    }
    setPollMs(live === 'online' ? SAFETY_NET_POLL_MS : SOCKET_DOWN_POLL_MS);
  }, [live, order]);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelError, setCancelError] = useState<unknown>(null);

  const cancelMutation = useMutation<GuestOrder, unknown, void>({
    mutationFn: () => cancelOrder(id as string, undefined, language),
    onSuccess: (updated) => {
      setCancelError(null);
      queryClient.setQueryData(guestKeys.order(updated.id), updated);
      void queryClient.invalidateQueries({ queryKey: ['guest', 'orders'] });
    },
    onError: (caught) => setCancelError(caught),
  });

  if (isLoading) {
    return (
      <Stack alignItems="center" sx={{ py: 8 }}>
        <CircularProgress aria-label={t('guest.common.loading')} />
      </Stack>
    );
  }

  if (error || !order) {
    return (
      <Container maxWidth="sm" sx={{ py: 4 }}>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void refetch()}>
              {t('guest.common.retry')}
            </Button>
          }
        >
          {errorMessage(error, t)}
        </Alert>
      </Container>
    );
  }

  const fieldValues = order.field_values ?? [];

  /*
    ЧЕМ ЭТА КАРТОЧКА ОТВЕЧАЕТ ГОСТЮ — решает СЕРВЕР.

    Вид приезжает из того же реестра, что и тип трекера персонала: гость и
    стойка не должны расходиться в том, что это за заявка. Падение на «доставку»
    здесь только для старого ответа без поля — новый его всегда несёт.

    Карточка была одна на все сервисы, и запись на массаж показывала поля
    доставки: «Куда — номер 305», «Когда — как можно скорее», «подадут к 01:21»,
    хотя сеанс назначен на 11:00 и лежал ниже, в позиции.
  */
  const kind =
    order.card_kind ?? (order.slot ? 'booking' : fieldValues.length ? 'request' : 'delivery');
  // Обещания времени подачи — только там, где подача есть. У записи время
  // назначено, у заявки его никто не обещал.
  const promisesServeTime = kind === 'delivery';

  // The promised serve time, in the hotel's TZ. One chip, shown on the just-placed
  // confirmation banner OR on the live status header — never both at once, so the
  // `guest-serve-by` testid stays unique.
  const serveBy = promisesServeTime ? serveByTime(order.serve_by) : null;
  const serveByChip = serveBy ? (
    <Chip
      size="small"
      variant="outlined"
      icon={<ScheduleIcon sx={{ fontSize: 16 }} />}
      label={t('guest.order.serveBy', { time: serveBy })}
      data-testid="guest-serve-by"
    />
  ) : null;

  const created = (() => {
    try {
      return new Intl.DateTimeFormat(i18n.resolvedLanguage ?? 'en', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date(order.created_at));
    } catch {
      return order.created_at;
    }
  })();

  const locale = i18n.resolvedLanguage ?? 'en';
  const at = (iso: string, options: Intl.DateTimeFormatOptions) => {
    try {
      return new Intl.DateTimeFormat(locale, options).format(new Date(iso));
    } catch {
      return iso;
    }
  };
  const clock = { hour: '2-digit', minute: '2-digit' } as const;

  const whenText = order.requested_time
    ? t('guest.order.byTime', { time: at(order.requested_time, clock) })
    : t('guest.cart.asap');

  /*
    ФАКТЫ ПО ВИДУ КАРТОЧКИ.

    Ни одного поля, которое для этого вида бессмысленно, и ни одной пустой
    заглушки: строка появляется, только если её есть чем заполнить. «Как можно
    скорее» осталось ровно там, где оно правда бывает, — у доставки и у подачи
    машины.
  */
  const facts: { label: string; value: string }[] = [];
  const push = (label: string, value: string | null | undefined) => {
    if (value) facts.push({ label, value });
  };
  const where = locationText(order, t);
  if (kind === 'booking') {
    const slot = order.slot;
    push(
      t('guest.order.sessionAt'),
      slot
        ? `${at(slot.starts_at, { weekday: 'short', day: 'numeric', month: 'short' })}, ` +
            `${at(slot.starts_at, clock)} – ${at(slot.ends_at, clock)}`
        : null,
    );
    push(
      t('guest.order.duration'),
      slot?.duration_minutes
        ? t('guest.order.durationMinutes', { minutes: slot.duration_minutes })
        : null,
    );
    // Где проходит сеанс: имя ресурса, а не «номер 305» — массаж делают в спа.
    push(t('guest.order.place'), order.slot?.resource_title ?? null);
  } else if (kind === 'ride') {
    // Откуда и куда лежат в ответах формы и показаны блоком ниже: повторять их
    // здесь значило бы напечатать маршрут дважды.
    push(t('guest.order.pickup'), whenText);
  } else if (kind === 'request') {
    push(
      t('guest.order.asked'),
      order.items.length ? order.items.map((line) => line.title).join(' · ') : null,
    );
    push(t('guest.order.acceptedAt'), at(order.created_at, { ...clock, dateStyle: undefined }));
  } else {
    push(t('guest.order.where'), where === '—' ? null : where);
    push(t('guest.order.when'), whenText);
  }

  return (
    <Container maxWidth="sm" sx={{ py: 2 }} data-testid="guest-order-status">
      <Stack spacing={2.5}>
        {justPlaced ? (
          <Paper
            variant="outlined"
            sx={{ p: 2, borderColor: 'success.main' }}
            data-testid="guest-confirmation"
          >
            <Stack spacing={1.5} alignItems="flex-start">
              <Stack direction="row" spacing={1} alignItems="center">
                <CheckCircleOutlineIcon color="success" />
                <Typography variant="h6">{t('guest.confirmation.title')}</Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {t('guest.confirmation.subtitle')}
              </Typography>
              {serveByChip}
              {/*
                Разрешение спрашиваем ЗДЕСЬ, а не при первом открытии: до
                заказа вопрос «можно ли вам писать» беспредметен, а отказ
                браузер запоминает навсегда — второго раза не будет.
              */}
              <Box sx={{ width: '100%' }}>
                <NotificationsOptIn />
              </Box>
              <Stack direction="row" spacing={1} sx={{ width: '100%' }}>
                <Button
                  variant="contained"
                  onClick={() => {
                    const next = new URLSearchParams(searchParams);
                    next.delete('placed');
                    setSearchParams(next, { replace: true });
                  }}
                  data-testid="guest-track-order"
                  sx={{ minHeight: 44, flexGrow: 1 }}
                >
                  {t('guest.confirmation.track')}
                </Button>
                <Button
                  variant="outlined"
                  onClick={() => navigate('/menu')}
                  sx={{ minHeight: 44, flexGrow: 1 }}
                >
                  {t('guest.confirmation.toMenu')}
                </Button>
              </Stack>
            </Stack>
          </Paper>
        ) : null}

        <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
          <Typography variant="h6" component="h1" data-testid="guest-order-number">
            {t('guest.order.number', { number: order.number })}
          </Typography>
          {/*
            Тест-идентификатор на ТЕКУЩЕМ статусе. Без него проверкам
            доставалась только карточка целиком, а в ней ниже лежит лента всех
            шагов — «Готовится», «В пути», «Доставлено» присутствуют там всегда,
            даже не наступив. Проверка `toContainText('Готовится')` проходила и
            тогда, когда переход вовсе не случился: доказано укусом с 409.
          */}
          <Chip
            size="small"
            label={order.status.title}
            color="primary"
            data-testid="guest-order-current-status"
          />
          {live === 'offline' && !order.status.is_terminal ? (
            <Chip
              size="small"
              variant="outlined"
              icon={<CloudOffIcon sx={{ fontSize: 16 }} />}
              label={t('guest.order.offline')}
              data-testid="guest-order-offline"
            />
          ) : null}
          {!justPlaced ? serveByChip : null}
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {created}
        </Typography>

        {order.eta_minutes && promisesServeTime ? (
          <Alert severity="info" icon={false} data-testid="guest-order-eta">
            {t('guest.order.eta', { minutes: order.eta_minutes })}
          </Alert>
        ) : null}

        <Paper variant="outlined" sx={{ p: 2 }}>
          <OrderTimeline order={order} />
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }} data-testid="guest-order-facts" data-kind={kind}>
          <Stack spacing={1}>
            {facts.map((fact) => (
              <Row key={fact.label} label={fact.label} value={fact.value} />
            ))}
            {order.comment ? (
              <Row label={t('guest.cart.comment')} value={order.comment} />
            ) : null}
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Stack divider={<Divider flexItem />} spacing={1.5}>
            {/* Body of the order, chosen by the block that is present: a booked
                slot, the answers of a request, or the lines of food. */}
            {/* Слот показан фактами выше (когда, сколько, где) — второй раз
                та же тройка читалась бы как две разные записи. Блок остаётся
                для брони без разобранных фактов: ресурс назван в нём. */}
            {order.slot && kind !== 'booking' ? (
              <OrderSlot
                slot={order.slot}
                language={language}
                guestLabel={locationText(order, t)}
                testId="guest-order-slot"
              />
            ) : null}
            {fieldValues.length ? (
              <OrderFieldValues values={fieldValues} testId="guest-order-fields" />
            ) : null}
            {/* A booking's line is the slot item itself; the slot block above
                already names it, so the raw line would only repeat it. */}
            {(order.slot ? [] : order.items).map((line) => (
              <Stack key={line.id} direction="row" spacing={1.5} alignItems="flex-start">
                <ItemThumb src={line.image_url} alt={line.title} size={48} />
                <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="subtitle2">
                    {line.title} · {line.quantity}
                  </Typography>
                  {line.modifiers?.length ? (
                    <Typography variant="caption" color="text.secondary">
                      {line.modifiers.map((modifier) => modifier.title).join(' · ')}
                    </Typography>
                  ) : null}
                  {line.comment ? (
                    <Typography variant="caption" color="text.secondary">
                      {line.comment}
                    </Typography>
                  ) : null}
                </Stack>
                {formatOptional(line.line_total) ? (
                  <Typography variant="body2">{formatOptional(line.line_total)}</Typography>
                ) : null}
              </Stack>
            ))}
            {/* An unpriced order has no total — a dash, never "0 ₽". */}
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="subtitle1">{t('guest.cart.total')}</Typography>
              <Typography variant="subtitle1" data-testid="guest-order-total">
                {formatOptional(order.total) ?? t('guest.order.noPrice')}
              </Typography>
            </Stack>
          </Stack>
        </Paper>

        {/* "Rate it" — only after a terminal status, and only if the hotel
            collects reviews. The block decides its own visibility from the order. */}
        <ReviewBlock order={order} />

        {cancelError ? (
          <Alert severity="error">{errorMessage(cancelError, t)}</Alert>
        ) : null}

        {order.status.allows_guest_cancel ? (
          <Button
            variant="outlined"
            color="error"
            disabled={cancelMutation.isPending}
            onClick={() => setConfirmOpen(true)}
            data-testid="guest-cancel-order"
            sx={{ minHeight: 48 }}
          >
            {t('guest.order.cancel')}
          </Button>
        ) : null}

        <Button variant="text" onClick={() => navigate('/orders')} sx={{ minHeight: 44 }}>
          {t('guest.order.allOrders')}
        </Button>

        <Box sx={{ height: 8 }} />
      </Stack>

      <ConfirmDialog
        open={confirmOpen}
        testId="guest-cancel"
        title={t('guest.order.cancelConfirmTitle')}
        description={t('guest.order.cancelConfirmBody')}
        confirmLabel={t('guest.order.cancel')}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          cancelMutation.mutate();
        }}
      />
    </Container>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" justifyContent="space-between" spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ textAlign: 'end' }}>
        {value}
      </Typography>
    </Stack>
  );
}

function locationText(order: GuestOrder, t: TFunction): string {
  const parts: string[] = [];
  if (order.location?.title) parts.push(order.location.title);
  if (order.location?.refinement) parts.push(order.location.refinement);
  if (order.room) parts.push(t('guest.common.roomShort', { room: order.room }));
  return parts.join(' · ') || '—';
}
