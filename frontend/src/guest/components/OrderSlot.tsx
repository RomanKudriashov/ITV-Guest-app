import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import EventSeatOutlinedIcon from '@mui/icons-material/EventSeatOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';

import type { OrderSlot as OrderSlotData } from '../api/types';

export interface OrderSlotProps {
  slot: OrderSlotData;
  language: string;
  /** Who the booking is for — the guest room/where, shown when known. */
  guestLabel?: string | null;
  dense?: boolean;
  testId?: string;
}

function timeRange(slot: OrderSlotData, language: string): string {
  try {
    const time = (iso: string) =>
      new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }).format(
        new Date(iso),
      );
    const day = new Intl.DateTimeFormat(language, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(new Date(slot.starts_at));
    return `${day}, ${time(slot.starts_at)} – ${time(slot.ends_at)}`;
  } catch {
    return `${slot.starts_at} – ${slot.ends_at}`;
  }
}

/**
 * The body of a booking order: the reserved resource, its time window and the
 * guest it is for. Shared by the storefront and the tracker on purpose — the
 * spa attendant and the guest look at the same slot, so the block lives once.
 */
export function OrderSlot({ slot, language, guestLabel, dense, testId }: OrderSlotProps) {
  const variant = dense ? 'caption' : 'body2';
  return (
    <Stack spacing={dense ? 0.25 : 0.75} data-testid={testId}>
      <Stack direction="row" spacing={0.75} alignItems="center">
        <EventSeatOutlinedIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
        <Typography variant={dense ? 'body2' : 'subtitle2'}>{slot.resource_title}</Typography>
      </Stack>
      <Stack direction="row" spacing={0.75} alignItems="center">
        <AccessTimeIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
        <Typography variant={variant} color="text.secondary">
          {timeRange(slot, language)}
        </Typography>
      </Stack>
      {guestLabel ? (
        <Stack direction="row" spacing={0.75} alignItems="center">
          <PersonOutlineIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
          <Typography variant={variant} color="text.secondary">
            {guestLabel}
          </Typography>
        </Stack>
      ) : null}
    </Stack>
  );
}
