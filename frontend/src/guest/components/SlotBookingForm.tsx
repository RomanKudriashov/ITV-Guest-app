import { useEffect, useMemo, useState, type Ref } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { ApiError } from '@/api/client';
import { ItemHeadline } from './ItemHeadline';
import { ctaGradientSx } from '@/kit';
import { SheetFooter, SheetScroll } from './sheetLayout';
import { errorMessage } from '../errors';
import { useGuestLanguage, useGuestSlots } from '../hooks/useGuestQueries';
import { useOrderSubmit } from '../hooks/useOrderSubmit';
import { useGuestSession } from '../session/GuestSessionProvider';
import type { CreateOrderPayload, GuestSlot, ItemDetail } from '../api/types';

export interface SlotBookingFormProps {
  item: ItemDetail;
  titleRef: Ref<HTMLHeadingElement>;
  onClose: () => void;
}

/** Today in the guest's locale as `YYYY-MM-DD` — the picker's default and floor. */
function todayIso(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function clockLabel(iso: string, language: string): string {
  try {
    return new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }).format(
      new Date(iso),
    );
  } catch {
    return iso;
  }
}

/**
 * Body of the sheet for a `slot` offering: pick a date, see the day's
 * availability, choose a free slot and book it.
 *
 * The booking is not a second checkout — it goes through the very same
 * `POST /api/guest/order` (via `useOrderSubmit`) as food and services, only with
 * a `slot_start`, and lands on the same confirmation → live status → history.
 * The single race to guard is two guests taking the last slot: the server answers
 * `409 slot_taken`, and here that reloads availability and asks for another slot.
 */
export function SlotBookingForm({ item, titleRef, onClose }: SlotBookingFormProps) {
  const { t } = useTranslation();
  const language = useGuestLanguage();
  const { canOrder } = useGuestSession();

  const today = useMemo(todayIso, []);
  const [date, setDate] = useState(today);
  const [selected, setSelected] = useState<string | null>(null);

  const slotsQuery = useGuestSlots(item.id, date, item.is_available);
  const slots = slotsQuery.data?.slots ?? [];
  const capacity = slotsQuery.data?.capacity ?? 1;

  const payload = useMemo<CreateOrderPayload | null>(
    () =>
      selected
        ? {
            lines: [{ item_id: item.id, quantity: 1 }],
            timing: 'asap',
            requested_time: null,
            comment: '',
            slot_start: selected,
          }
        : null,
    [selected, item.id],
  );

  const { submit, isPending, failure } = useOrderSubmit(payload, { onPlaced: onClose });

  // The one race a booking has to survive: someone took the slot first. Reload
  // the grid and drop the now-invalid choice so the guest picks another.
  const takenRace = failure instanceof ApiError && failure.code === 'slot_taken';
  useEffect(() => {
    if (takenRace) {
      setSelected(null);
      void slotsQuery.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [takenRace]);

  const handleBook = () => {
    if (!canOrder || !selected) return;
    submit();
  };

  return (
    <>
      <SheetScroll>
        <Stack spacing={2} data-testid="guest-slot-form">
          <ItemHeadline item={item} ref={titleRef} />

          {!canOrder ? (
            <Alert severity="warning" data-testid="guest-slot-trust">
              {t('guest.errors.trustRequired')}
            </Alert>
          ) : null}

          <Divider />

          <TextField
            type="date"
            label={t('guest.slot.date')}
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
              setSelected(null);
            }}
            InputLabelProps={{ shrink: true }}
            inputProps={{ min: today, 'data-testid': 'guest-slot-date' }}
          />

          {slotsQuery.isLoading ? (
            <Stack alignItems="center" sx={{ py: 4 }}>
              <CircularProgress aria-label={t('guest.common.loading')} />
            </Stack>
          ) : slotsQuery.isError ? (
            <Alert severity="error">{errorMessage(slotsQuery.error, t)}</Alert>
          ) : slots.length === 0 ? (
            <Typography variant="body2" color="text.secondary" data-testid="guest-slot-empty">
              {t('guest.slot.none')}
            </Typography>
          ) : (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))',
                gap: 1,
              }}
            >
              {slots.map((slot) => (
                <SlotButton
                  key={slot.starts_at}
                  slot={slot}
                  capacity={capacity}
                  selected={selected === slot.starts_at}
                  language={language}
                  onSelect={() => setSelected(slot.starts_at)}
                  takenLabel={t('guest.slot.taken')}
                  leftLabel={(left: number) => t('guest.slot.left', { count: left })}
                />
              ))}
            </Box>
          )}

          {takenRace ? (
            <Alert severity="warning" data-testid="guest-slot-taken">
              {t('guest.slot.raceLost')}
            </Alert>
          ) : failure ? (
            <Alert severity="error" data-testid="guest-order-error">
              {errorMessage(failure, t)}
            </Alert>
          ) : null}
        </Stack>
      </SheetScroll>

      <SheetFooter>
        <Button
          fullWidth
          size="large"
          variant="contained"
          disabled={!canOrder || isPending || !item.is_available || !selected}
          onClick={handleBook}
          data-testid="guest-slot-book"
          sx={[ctaGradientSx, { minHeight: 52 }]}
        >
          {isPending
            ? t('guest.slot.booking')
            : selected
              ? t('guest.slot.bookAt', { time: clockLabel(selected, language) })
              : t('guest.slot.book')}
        </Button>
      </SheetFooter>
    </>
  );
}

interface SlotButtonProps {
  slot: GuestSlot;
  capacity: number;
  selected: boolean;
  language: string;
  onSelect: () => void;
  takenLabel: string;
  leftLabel: (left: number) => string;
}

function SlotButton({
  slot,
  capacity,
  selected,
  language,
  onSelect,
  takenLabel,
  leftLabel,
}: SlotButtonProps) {
  const available = slot.available && slot.capacity_left > 0;
  // Show remaining capacity only when it is scarce and the resource holds more
  // than one guest — "2 left" is meaningful, "1 left" on a capacity-1 room is not.
  const showLeft = available && capacity > 1;

  return (
    <ButtonBase
      disabled={!available}
      onClick={onSelect}
      data-testid={`guest-slot-${slot.starts_at}`}
      aria-pressed={selected}
      sx={{
        flexDirection: 'column',
        gap: 0.25,
        py: 1,
        px: 0.5,
        minHeight: 52,
        borderRadius: 2,
        border: 1,
        borderColor: selected ? 'primary.main' : 'divider',
        bgcolor: selected ? 'primary.main' : 'background.paper',
        color: selected ? 'primary.contrastText' : 'text.primary',
        opacity: available ? 1 : 0.5,
      }}
    >
      <Typography variant="body2" sx={{ fontWeight: selected ? 700 : 500 }}>
        {new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }).format(
          new Date(slot.starts_at),
        )}
      </Typography>
      {!available ? (
        <Typography variant="caption" color="text.secondary">
          {takenLabel}
        </Typography>
      ) : showLeft ? (
        <Typography variant="caption" color={selected ? 'inherit' : 'text.secondary'}>
          {leftLabel(slot.capacity_left)}
        </Typography>
      ) : null}
    </ButtonBase>
  );
}
