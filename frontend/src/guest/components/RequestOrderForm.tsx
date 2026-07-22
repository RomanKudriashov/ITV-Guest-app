import { useMemo, type Ref } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Paper from '@mui/material/Paper';
import Radio from '@mui/material/Radio';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { ApiError } from '@/api/client';
import { asksForLocation } from '@/offerings/behaviour';
import {
  seedFieldValue,
  serializeFieldValue,
  validateFieldValue,
} from '@/offerings/requestFields';
import { useDraftState } from '@/state/useDraftState';
import { ItemHeadline } from './ItemHeadline';
import { RequestFieldControl } from './RequestFieldControl';
import { ctaGradientSx } from '@/kit';
import { SheetFooter, SheetScroll } from './sheetLayout';
import { errorMessage } from '../errors';
import { useGuestLocations } from '../hooks/useGuestQueries';
import { useOrderSubmit } from '../hooks/useOrderSubmit';
import { useGuestSession } from '../session/GuestSessionProvider';
import type { CreateOrderPayload, ItemDetail, RequestField } from '../api/types';

interface RequestDraft {
  /** field code → raw value as typed. */
  values: Record<string, string>;
  touched: Record<string, boolean>;
  showErrors: boolean;
  comment: string;
  locationId: string | null;
  refinement: string;
}

export interface RequestOrderFormProps {
  item: ItemDetail;
  titleRef: Ref<HTMLHeadingElement>;
  onClose: () => void;
}

/**
 * Body of the sheet for an offering the guest fills in with a FORM.
 *
 * It is not a second checkout: the answers plus one line go through the very
 * same `POST /api/guest/order` (see `useOrderSubmit`), and the guest lands on the
 * same confirmation, live status and history as after ordering food. The cart is
 * not involved at all — a request is one item and is sent straight from here.
 */
export function RequestOrderForm({ item, titleRef, onClose }: RequestOrderFormProps) {
  const { t } = useTranslation();
  const { canOrder } = useGuestSession();

  const fields = useMemo<RequestField[]>(
    () =>
      [...(item.request_fields ?? [])].sort(
        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
      ),
    [item.request_fields],
  );

  // "Where to?" is asked only where it means something: for a taxi the pick-up
  // point is a field of the form, for housekeeping the room is already known.
  const needsLocation = asksForLocation(item.location_mode);
  const locationsQuery = useGuestLocations(needsLocation);
  const locations = useMemo(
    () => (needsLocation ? (locationsQuery.data?.locations ?? []) : []),
    [needsLocation, locationsQuery.data],
  );

  const [draft, setDraft] = useDraftState<RequestDraft>(
    () => ({
      values: Object.fromEntries(fields.map((field) => [field.code, seedFieldValue(field)])),
      touched: {},
      showErrors: false,
      comment: '',
      locationId:
        locations.find((location) => location.is_default)?.id ?? locations[0]?.id ?? null,
      refinement: '',
    }),
    `${item.id}:${fields.map((field) => field.code).join(',')}:${locations
      .map((location) => location.id)
      .join(',')}`,
  );

  const selectedLocation = locations.find((location) => location.id === draft.locationId) ?? null;
  const needsRefinement = Boolean(selectedLocation?.requires_refinement);
  const refinementMissing = needsRefinement && !draft.refinement.trim();

  /** Live validation: the same rules the server applies, shown while typing. */
  const fieldErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    for (const field of fields) {
      const problem = validateFieldValue(field, draft.values[field.code] ?? '');
      if (problem) errors[field.code] = t(problem.key, problem.params);
    }
    return errors;
  }, [fields, draft.values, t]);

  const invalid =
    Object.keys(fieldErrors).length > 0 ||
    refinementMissing ||
    (needsLocation && !draft.locationId);

  const payload = useMemo<CreateOrderPayload>(() => {
    const values: Record<string, string | number> = {};
    for (const field of fields) {
      const raw = draft.values[field.code] ?? '';
      if (!raw.trim()) continue;
      values[field.code] = serializeFieldValue(field, raw);
    }
    return {
      // A request is a one-line order on purpose: routing, pricing, stop-lists
      // and history keep working through exactly the same code as for food.
      lines: [{ item_id: item.id, quantity: 1 }],
      timing: 'asap',
      requested_time: null,
      comment: draft.comment.trim(),
      field_values: values,
      // Location keys are absent, not empty, when the item does not use them.
      ...(needsLocation
        ? {
            location_id: draft.locationId ?? '',
            location_refinement: needsRefinement ? draft.refinement.trim() : '',
            delivery_mode: locationsQuery.data?.delivery_modes?.[0] ?? 'delivery',
          }
        : {}),
    };
  }, [fields, draft, item.id, needsLocation, needsRefinement, locationsQuery.data]);

  const { submit, isPending, failure } = useOrderSubmit(payload, { onPlaced: onClose });

  const handleSubmit = () => {
    if (!canOrder) return;
    if (invalid) {
      setDraft((prev) => ({ ...prev, showErrors: true }));
      return;
    }
    submit();
  };

  const errorFor = (field: RequestField): string | null => {
    const problem = fieldErrors[field.code];
    if (!problem) return null;
    return draft.showErrors || draft.touched[field.code] ? problem : null;
  };

  const fieldError = failure instanceof ApiError ? failure.field : undefined;

  return (
    <>
      <SheetScroll>
        <Stack spacing={2} data-testid="guest-request-form">
          <ItemHeadline item={item} ref={titleRef} />

          {!canOrder ? (
            <Alert severity="warning" data-testid="guest-request-trust">
              {t('guest.errors.trustRequired')}
            </Alert>
          ) : null}

          <Divider />

          {fields.length ? (
            <Stack spacing={2}>
              {fields.map((field) => (
                <RequestFieldControl
                  key={field.code}
                  field={field}
                  value={draft.values[field.code] ?? ''}
                  error={errorFor(field)}
                  onChange={(value) =>
                    setDraft((prev) => ({
                      ...prev,
                      values: { ...prev.values, [field.code]: value },
                    }))
                  }
                  onBlur={() =>
                    setDraft((prev) => ({
                      ...prev,
                      touched: { ...prev.touched, [field.code]: true },
                    }))
                  }
                />
              ))}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {t('guest.request.noFields')}
            </Typography>
          )}

          {needsLocation ? (
            <Stack spacing={1}>
              <Typography variant="subtitle1">{t('guest.cart.where')}</Typography>
              <Paper variant="outlined">
                <Stack divider={<Divider flexItem />}>
                  {locations.map((location) => (
                    <FormControlLabel
                      key={location.id}
                      checked={draft.locationId === location.id}
                      onChange={() =>
                        setDraft((prev) => ({
                          ...prev,
                          locationId: location.id,
                          refinement: '',
                        }))
                      }
                      data-testid={`guest-location-${location.code}`}
                      control={<Radio />}
                      label={location.title}
                      sx={{ m: 0, px: 1, minHeight: 48 }}
                    />
                  ))}
                </Stack>
              </Paper>
              {needsRefinement ? (
                <TextField
                  fullWidth
                  label={selectedLocation?.refinement_label ?? t('guest.cart.refinement')}
                  value={draft.refinement}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, refinement: event.target.value }))
                  }
                  error={draft.showErrors && refinementMissing}
                  helperText={
                    draft.showErrors && refinementMissing
                      ? t('guest.errors.refinementRequired')
                      : undefined
                  }
                  inputProps={{ 'data-testid': 'guest-location-refinement', maxLength: 60 }}
                />
              ) : null}
            </Stack>
          ) : null}

          <TextField
            fullWidth
            multiline
            minRows={2}
            label={t('guest.request.comment')}
            placeholder={t('guest.request.commentPlaceholder')}
            value={draft.comment}
            onChange={(event) => setDraft((prev) => ({ ...prev, comment: event.target.value }))}
            inputProps={{ maxLength: 300, 'data-testid': 'guest-request-comment' }}
          />

          {failure ? (
            <Alert severity="error" data-testid="guest-order-error">
              {errorMessage(failure, t)}
              {fieldError ? ` (${fieldError})` : ''}
            </Alert>
          ) : null}
        </Stack>
      </SheetScroll>

      <SheetFooter>
        <Button
          fullWidth
          size="large"
          variant="contained"
          // Live validation, honestly reflected: while a required answer is
          // missing the request cannot be sent, and the guest sees which field
          // is at fault as soon as they touch it.
          disabled={!canOrder || isPending || !item.is_available || invalid}
          onClick={handleSubmit}
          data-testid="guest-request-submit"
          sx={[ctaGradientSx, { minHeight: 52 }]}
        >
          {isPending ? t('guest.request.sending') : t('guest.request.submit')}
        </Button>
      </SheetFooter>
    </>
  );
}
