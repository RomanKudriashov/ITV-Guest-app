import type { ReactNode } from 'react';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import MeetingRoomOutlinedIcon from '@mui/icons-material/MeetingRoomOutlined';
import { useTranslation } from 'react-i18next';

import type { TrackerRoomGroup } from '../api/types';

/**
 * ЗАЯВКИ ОДНОЙ КОМНАТЫ.
 *
 * Хозслужба работает по НОМЕРАМ, а не по заказам: горничная идёт по этажу, и
 * две заявки в один номер — это один поход, а не два. Раньше они приезжали
 * двумя карточками в одной колонке, и вторую находили, уже выйдя из номера.
 *
 * Заголовок называет комнату и число заявок в ней — по нему строят маршрут, не
 * читая карточки. Сами карточки остаются как есть: их берут, двигают и
 * перетаскивают поштучно, потому что и выполняются они поштучно.
 */
export function RoomGroup({
  group,
  children,
}: {
  group: TrackerRoomGroup;
  children: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <Stack spacing={1} data-testid={`tracker-room-${group.key}`}>
      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ px: 0.5 }}>
        <MeetingRoomOutlinedIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
        <Typography variant="subtitle2">
          {/* Заявка без комнаты — своя группа, и назвать её надо честно, а не
              подписать чужим номером. */}
          {group.room ? t('tracker.card.room', { room: group.room }) : t('tracker.group.noRoom')}
        </Typography>
        {group.orders.length > 1 ? (
          <Chip size="small" label={group.orders.length} data-testid={`tracker-room-count-${group.key}`} />
        ) : null}
      </Stack>
      <Stack spacing={1.25}>{children}</Stack>
    </Stack>
  );
}
