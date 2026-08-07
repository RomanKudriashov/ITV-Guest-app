import { useMemo, type ReactNode } from 'react';
import Stack from '@mui/material/Stack';
import { useTranslation } from 'react-i18next';

import {
  IconBlackout,
  IconMakeUpRoom,
  IconCurtain,
  IconDoNotDisturb,
  IconLightGroup,
  IconThermostat,
} from '@/icons';
import type { RoomStateSnapshot } from '../api/types';
import { groupControls, readingOn, useRoomReadings } from '../roomSnapshot';
import { useStorefront } from '../useStorefront';
import { StatusPill } from './roomKit';

/**
 * Строка состояния номера: температура, сколько зон горит, штора, блэкаут,
 * уборка, «не беспокоить».
 *
 * ОДИН КОМПОНЕНТ НА ДВА ЭКРАНА — номер и главная. Это не экономия строк:
 * пилюли отвечают на вопрос «что сейчас в номере», и два ответа на него,
 * посчитанные порознь, однажды разойдутся между экранами, по которым гость
 * ходит туда-сюда за десять секунд.
 *
 * Снимок компонент НЕ ЗАПРАШИВАЕТ — получает готовым. Источник состояния
 * номера в продукте один (`useRoomState` и его канал), и заводить второй ради
 * строки на главной было бы ровно тем, чего делать нельзя.
 *
 * Состояние не читается — пилюли нет вовсе. «—» вместо градусов это не
 * честность, а другой способ ничего не сказать.
 */

export function RoomStatusPills({ snapshot }: { snapshot: RoomStateSnapshot | undefined }) {
  const { t } = useTranslation();
  const { roomControl } = useStorefront();
  const readings = useRoomReadings(snapshot);
  const groups = useMemo(() => groupControls(snapshot?.zones ?? []), [snapshot]);
  if (!snapshot || snapshot.availability === 'unavailable') return null;

  const climate = groups.climate[0];
  const temperature = climate ? readings[climate.controlId]?.values.current_temp : undefined;
  const lit = groups.light.filter((control) => readingOn(readings[control.controlId]) === true).length;
  const known = groups.light.filter((control) => readingOn(readings[control.controlId]) !== null).length;

  // Штора и блэкаут лежат в одной группе — различаем ВИДОМ, а не порядком:
  // порядок приходит из снимка, и первой в нём может оказаться любая из двух.
  const curtain = groups.curtain.find((control) => control.kind === 'curtain');
  const curtainOn = curtain ? readingOn(readings[curtain.controlId]) : null;
  const blackout = groups.curtain.find((control) => control.kind === 'curtain_blackout');
  const blackoutOn = blackout ? readingOn(readings[blackout.controlId]) : null;
  const service = groups.service.find((control) => control.kind === 'dnd');
  const dnd = service ? readingOn(readings[service.controlId]) : null;
  const cleaning = groups.service.find((control) => control.kind === 'mur');
  const cleaningOn = cleaning ? readingOn(readings[cleaning.controlId]) : null;

  /*
    ПОРЯДОК ЗДЕСЬ — ЭТО ПРИОРИТЕТ: температура, свет, шторы, блэкаут, уборка,
    «не беспокоить». Строка одна и прокручивается, поэтому вопрос не «влезет
    ли», а «что гость увидит, не прокручивая»; заодно ряд не может вырасти
    вниз и наехать на план.
  */
  const pills: ReactNode[] = [];
  // Пилюля рисуется, ТОЛЬКО если её значение прочитано. «—» вместо градусов
  // это не честность, а просто другой способ ничего не сказать.
  if (typeof temperature === 'number') {
    pills.push(
      <StatusPill key="temp" tone="cold" icon={<IconThermostat size={13} />} testId="room-pill-temp">
        {t('guest.roomControl.pillTemp', { value: temperature })}
      </StatusPill>,
    );
  }
  if (known > 0) {
    pills.push(
      <StatusPill
        key="lit"
        tone={lit > 0 ? 'active' : 'neutral'}
        icon={<IconLightGroup size={13} />}
        testId="room-pill-lit"
      >
        {t('guest.roomControl.pillZones', { count: lit })}
      </StatusPill>,
    );
  }
  if (curtainOn !== null) {
    pills.push(
      <StatusPill
        key="curtain"
        tone={curtainOn ? 'active' : 'neutral'}
        icon={<IconCurtain size={13} />}
        testId="room-pill-curtain"
      >
        {curtainOn ? t('guest.roomControl.curtainOpen') : t('guest.roomControl.curtainClosed')}
      </StatusPill>,
    );
  }
  /*
    БЛЭКАУТ И УБОРКА ПОКАЗЫВАЮТСЯ ТОЛЬКО В СВОЁМ СОСТОЯНИИ.

    Открытый блэкаут и незаказанная уборка — это ничего не значащие «нет», и
    занимать ими строку значит вытеснить из виду то, что происходит. Пилюля
    появляется, когда состояние наступило, и исчезает, когда оно снято.
  */
  if (blackoutOn === false) {
    pills.push(
      <StatusPill
        key="blackout"
        tone="active"
        icon={<IconBlackout size={13} />}
        testId="room-pill-blackout"
      >
        {t('guest.roomControl.pillBlackoutClosed')}
      </StatusPill>,
    );
  }
  if (cleaningOn === true) {
    pills.push(
      <StatusPill
        key="cleaning"
        tone="active"
        icon={<IconMakeUpRoom size={13} />}
        testId="room-pill-cleaning"
      >
        {t('guest.roomControl.pillCleaning')}
      </StatusPill>,
    );
  }
  if (dnd !== null) {
    pills.push(
      <StatusPill
        key="dnd"
        tone={dnd ? 'active' : 'neutral'}
        icon={<IconDoNotDisturb size={13} />}
        testId="room-pill-dnd"
      >
        {dnd ? t('guest.roomControl.pillDndOn') : t('guest.roomControl.pillDndOff')}
      </StatusPill>,
    );
  }
  if (!pills.length) return null;

  return (
    <Stack
      direction="row"
      sx={{
        // Одной строкой с прокруткой, а не переносом: три ряда пилюль на
        // телефоне съедали экран до того, как гость видел план.
        gap: 1,
        overflowX: 'auto',
        pb: 0.5,
        // Край прокрутки виден: строка, обрезанная ровно по границе экрана,
        // читается как обрыв вёрстки, а не как «дальше есть ещё».
        maskImage: roomControl.fadeEdge,
        WebkitMaskImage: roomControl.fadeEdge,
        scrollbarWidth: 'none',
        '&::-webkit-scrollbar': { display: 'none' },
      }}
      data-testid="room-pills"
    >
      {pills}
    </Stack>
  );
}
