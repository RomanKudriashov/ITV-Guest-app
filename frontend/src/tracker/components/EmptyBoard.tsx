import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CloudOffOutlinedIcon from '@mui/icons-material/CloudOffOutlined';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import WbSunnyOutlinedIcon from '@mui/icons-material/WbSunnyOutlined';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/EmptyState';
import { formatAge, formatClock } from '../orderAge';
import type { TrackerShift } from '../api/types';

/**
 * ПУСТАЯ ДОСКА — НЕ ИЗВИНЕНИЕ.
 *
 * Ресепшен смотрел в значок и «Заказов нет» часами: заявок там может не быть
 * полсмены, и экран выглядел сломанным ровно тогда, когда всё в порядке.
 *
 * Пусто бывает по трём РАЗНЫМ причинам, и раньше все три показывались
 * одинаково:
 *
 *   1. Работы нет сейчас, но смена шла — показываем ИТОГ: сколько сделано, как
 *      быстро, когда была последняя заявка. Экран занят делом.
 *   2. Смена только началась — итога ещё нет, и придумывать его нельзя. Честно:
 *      «смена началась в 00:00, заявок пока не было».
 *   3. СВЯЗИ НЕТ — и это вообще не «пусто». Доска, которая молчит из-за
 *      оборванного канала, читается как «работы нет», и человек спокойно ждёт,
 *      пока заявки копятся на сервере. Это ровно то враньё, от которого мы
 *      лечили экран номера, и здесь оно опаснее: там врали гостю, здесь —
 *      смене.
 */

export interface EmptyBoardProps {
  shift?: TrackerShift;
  /**
   * ПУСТОТА НЕ ПОДТВЕРЖДЕНА: сокет молчит И свежего ответа по опросу тоже нет.
   *
   * Одного «сокет упал» мало — доска при обрыве продолжает опрашиваться по
   * REST, и если опрос отвечает, мы ЗНАЕМ, что заявок нет. Кричать «связи
   * нет» в этот момент значило бы соврать в другую сторону: смена решила бы,
   * что экран сломан, и пошла спрашивать вручную.
   */
  unconfirmed: boolean;
  language: string;
}

export function EmptyBoard({ shift, unconfirmed, language }: EmptyBoardProps) {
  const { t } = useTranslation();

  // 3. Пустота не подтверждена. Первым, потому что всё остальное тогда —
  // догадки: сводка могла устареть, а заявки могли прийти и не доехать.
  if (unconfirmed) {
    return (
      <EmptyState
        icon={<CloudOffOutlinedIcon fontSize="large" />}
        title={t('tracker.board.offlineTitle')}
        description={t('tracker.board.offlineBody')}
        testId="tracker-empty-offline"
      />
    );
  }

  const done = shift?.done ?? 0;

  // 2. Смена только началась: делать вид, что итог есть, нельзя.
  if (!shift || done === 0) {
    return (
      <Stack alignItems="center" spacing={1} sx={{ py: 6, px: 3, textAlign: 'center' }}>
        <Box sx={{ opacity: 0.6, color: 'text.secondary' }}>
          <WbSunnyOutlinedIcon fontSize="large" />
        </Box>
        <Typography variant="subtitle1" data-testid="tracker-empty-fresh">
          {shift
            ? t('tracker.board.shiftFresh', {
                time: formatClock(shift.shift_started_at, language),
              })
            : t('tracker.board.emptyTitle')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('tracker.board.emptyBody')}
        </Typography>
        {/* Когда была последняя заявка ВООБЩЕ — единственное, что отличает
            затишье от неработающего экрана в самом начале смены. */}
        {shift?.last_order_at ? (
          <Typography variant="caption" color="text.secondary">
            {t('tracker.board.lastOrder', {
              age: formatAge(minutesSince(shift.last_order_at), shift.last_order_at, t, language),
            })}
          </Typography>
        ) : null}
      </Stack>
    );
  }

  // 1. Затишье посреди смены — итог.
  return (
    <Stack alignItems="center" spacing={1} sx={{ py: 6, px: 3, textAlign: 'center' }}>
      <Box sx={{ opacity: 0.6, color: 'success.main' }}>
        <DoneAllIcon fontSize="large" />
      </Box>
      <Typography variant="subtitle1" data-testid="tracker-empty-summary">
        {t('tracker.board.shiftDone', { count: done })}
      </Typography>
      <Stack spacing={0.25}>
        {shift.median_minutes !== null ? (
          <Typography variant="body2" color="text.secondary">
            {t('tracker.board.shiftSpeed', {
              duration: formatAge(shift.median_minutes, null, t, language),
            })}
          </Typography>
        ) : null}
        {/*
          Время до принятия — ОТДЕЛЬНОЙ строкой. Это скорость реакции: сколько
          заявка пролежала невзятой. Медленная кухня и невнимательная смена —
          разные болезни, и одно число на двоих лечило бы не то.
        */}
        {shift.median_pickup_minutes !== null ? (
          <Typography variant="body2" color="text.secondary">
            {t('tracker.board.shiftPickup', {
              duration: formatAge(shift.median_pickup_minutes, null, t, language),
            })}
          </Typography>
        ) : null}
        {shift.last_order_at ? (
          <Typography variant="caption" color="text.secondary">
            {t('tracker.board.lastOrder', {
              age: formatAge(minutesSince(shift.last_order_at), shift.last_order_at, t, language),
            })}
          </Typography>
        ) : null}
      </Stack>
    </Stack>
  );
}

/**
 * Сколько минут прошло с момента. Единственное место, где возраст считается на
 * клиенте: у сервера нет поля «сколько назад была последняя заявка», а гонять
 * ради него отдельный запрос дороже, чем вычесть две даты. Момент при этом
 * СЕРВЕРНЫЙ — в таймзоне отеля.
 */
function minutesSince(iso: string): number {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return 0;
  return Math.max(0, Math.round((Date.now() - at) / 60_000));
}
