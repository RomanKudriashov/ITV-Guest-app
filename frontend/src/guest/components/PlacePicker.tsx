import Alert from '@mui/material/Alert';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Paper from '@mui/material/Paper';
import Radio from '@mui/material/Radio';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useTranslation } from 'react-i18next';

import type { GuestLocation } from '../api/types';

export interface PlaceChoice {
  locationId: string | null;
  refinement: string;
}

/**
 * Где получить заказ: список мест, уточнение и — для точки выдачи — прямое
 * «заберёте сами». Способ получения здесь не выбирается: он следует из места.
 *
 * `testPrefix` различает общий выбор и выбор для части корзины, чтобы
 * проверки находили нужный список, не гадая по порядку.
 */
export function PlacePicker({
  locations,
  choice,
  onChange,
  showErrors,
  testPrefix = 'guest-location',
}: {
  locations: GuestLocation[];
  choice: PlaceChoice;
  onChange: (next: PlaceChoice) => void;
  showErrors: boolean;
  testPrefix?: string;
}) {
  const { t } = useTranslation();
  const selected = locations.find((location) => location.id === choice.locationId) ?? null;
  const needsRefinement = Boolean(selected?.requires_refinement);
  const refinementMissing = needsRefinement && !choice.refinement.trim();

  return (
    <Stack spacing={1}>
      <Paper variant="outlined">
        <Stack divider={<Divider flexItem />}>
          {locations.map((location) => (
            <FormControlLabel
              key={location.id}
              checked={choice.locationId === location.id}
              onChange={() => onChange({ locationId: location.id, refinement: '' })}
              data-testid={`${testPrefix}-${location.code}`}
              control={<Radio />}
              label={location.title}
              sx={{ m: 0, px: 1, minHeight: 48 }}
            />
          ))}
        </Stack>
      </Paper>
      {selected?.delivery_mode === 'pickup' ? (
        <Alert severity="info" data-testid={`${testPrefix}-pickup-hint`}>
          {t('guest.cart.pickupHint', { place: selected.title })}
        </Alert>
      ) : null}
      {needsRefinement ? (
        <TextField
          fullWidth
          label={selected?.refinement_label ?? t('guest.cart.refinement')}
          value={choice.refinement}
          onChange={(event) => onChange({ ...choice, refinement: event.target.value })}
          error={showErrors && refinementMissing}
          helperText={
            showErrors && refinementMissing ? t('guest.errors.refinementRequired') : undefined
          }
          inputProps={{ 'data-testid': `${testPrefix}-refinement`, maxLength: 60 }}
        />
      ) : null}
    </Stack>
  );
}

/** Место выбрано и, если нужно, уточнено. */
export function placeIsComplete(locations: GuestLocation[], choice: PlaceChoice): boolean {
  const selected = locations.find((location) => location.id === choice.locationId);
  if (!selected) return false;
  return !selected.requires_refinement || Boolean(choice.refinement.trim());
}

/** Место по умолчанию: номер гостя, иначе первое из доступных. */
export function defaultPlace(locations: GuestLocation[]): PlaceChoice {
  return {
    locationId: locations.find((location) => location.is_default)?.id ?? locations[0]?.id ?? null,
    refinement: '',
  };
}
