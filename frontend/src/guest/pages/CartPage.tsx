import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Radio from '@mui/material/Radio';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { useTranslation } from 'react-i18next';

import { ApiError } from '@/api/client';
import { EmptyState } from '@/components/EmptyState';
import { ItemThumb } from '../components/ItemMeta';
import { QuantityStepper } from '../components/QuantityStepper';
import { StickyFooter } from '../components/StickyFooter';
import { createOrder } from '../api/guest';
import { guestKeys } from '../api/queryKeys';
import { errorMessage, isRetryableOrderError } from '../errors';
import { useGuestLanguage, useGuestLocations } from '../hooks/useGuestQueries';
import { useIdempotencyKey } from '../hooks/useIdempotencyKey';
import { useMoney } from '../hooks/useMoney';
import { BOTTOM_NAV_HEIGHT } from '../layout/GuestLayout';
import { useGuestSession } from '../session/GuestSessionProvider';
import { useCart } from '../state/cart';
import { useDraftState } from '@/state/useDraftState';
import type { CreateOrderPayload, GuestOrder, OrderTiming } from '../api/types';

interface CheckoutDraft {
  locationId: string | null;
  refinement: string;
  timing: OrderTiming;
  /** "HH:MM" from the native time input. */
  time: string;
  comment: string;
  showErrors: boolean;
}

/** "19:30" → ISO with offset. Times already past today are read as tomorrow. */
function timeToIso(time: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const now = new Date();
  const target = new Date(now);
  target.setHours(Number(match[1]), Number(match[2]), 0, 0);
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
  return target.toISOString();
}

export function CartPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { format } = useMoney();
  const cart = useCart();
  const { canOrder } = useGuestSession();
  const language = useGuestLanguage();
  const locationsQuery = useGuestLocations();

  const locations = useMemo(
    () => locationsQuery.data?.locations ?? [],
    [locationsQuery.data],
  );

  // Checkout form — local draft state, never overwritten by a background refetch
  // of the locations list. Re-seeded only when the locations set itself changes.
  const [draft, setDraft] = useDraftState<CheckoutDraft>(
    () => ({
      locationId: locations.find((location) => location.is_default)?.id ?? locations[0]?.id ?? null,
      refinement: '',
      timing: 'asap',
      time: '',
      comment: '',
      showErrors: false,
    }),
    locations.map((location) => location.id).join(','),
  );

  const selectedLocation = locations.find((location) => location.id === draft.locationId) ?? null;
  const needsRefinement = Boolean(selectedLocation?.requires_refinement);
  const refinementMissing = needsRefinement && !draft.refinement.trim();
  const timeMissing = draft.timing === 'scheduled' && !timeToIso(draft.time);

  const payload = useMemo<CreateOrderPayload>(
    () => ({
      lines: cart.toPayloadLines(),
      location_id: draft.locationId ?? '',
      location_refinement: needsRefinement ? draft.refinement.trim() : '',
      delivery_mode: locationsQuery.data?.delivery_modes?.[0] ?? 'delivery',
      timing: draft.timing,
      requested_time: draft.timing === 'scheduled' ? timeToIso(draft.time) : null,
      comment: draft.comment.trim(),
    }),
    [cart, draft, needsRefinement, locationsQuery.data],
  );

  // One key per attempt; a changed body mints a new one (else the server 409s).
  const [idempotencyKey, rotateKey] = useIdempotencyKey(JSON.stringify(payload));
  const [failure, setFailure] = useState<unknown>(null);

  const mutation = useMutation<GuestOrder, unknown, void>({
    mutationFn: () => createOrder(payload, idempotencyKey, language),
    onSuccess: (order) => {
      setFailure(null);
      queryClient.setQueryData(guestKeys.order(order.id), order);
      void queryClient.invalidateQueries({ queryKey: ['guest', 'orders'] });
      cart.clear();
      rotateKey();
      navigate(`/orders/${order.id}?placed=1`, { replace: true });
    },
    onError: (error) => setFailure(error),
  });

  const submit = () => {
    if (!canOrder) return;
    if (!draft.locationId || refinementMissing || timeMissing) {
      setDraft((prev) => ({ ...prev, showErrors: true }));
      return;
    }
    mutation.mutate();
  };

  if (cart.isEmpty) {
    return (
      <Box data-testid="guest-cart">
        <EmptyState
          title={t('guest.cart.emptyTitle')}
          description={t('guest.cart.emptyHint')}
          testId="guest-cart-empty"
          action={
            <Button variant="contained" onClick={() => navigate('/menu')} sx={{ minHeight: 44 }}>
              {t('guest.cart.toMenu')}
            </Button>
          }
        />
      </Box>
    );
  }

  const fieldError = failure instanceof ApiError ? failure.field : undefined;

  return (
    <Box data-testid="guest-cart">
      <Container maxWidth="sm" sx={{ py: 2, pb: 18 }}>
        <Stack spacing={2.5}>
          <Typography variant="h6" component="h1">
            {t('guest.cart.title')}
          </Typography>

          {!canOrder ? (
            <Alert severity="warning" data-testid="guest-cart-trust">
              {t('guest.errors.trustRequired')}
            </Alert>
          ) : null}

          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Stack divider={<Divider flexItem />} spacing={1.5}>
              {cart.lines.map((line) => (
                <Stack
                  key={line.uid}
                  direction="row"
                  spacing={1.5}
                  alignItems="flex-start"
                  data-testid={`guest-cart-line-${line.item_code}`}
                >
                  <ItemThumb src={line.image_url} alt={line.title} size={56} />
                  <Stack spacing={0.5} sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography variant="subtitle2">{line.title}</Typography>
                    {line.modifiers.length ? (
                      <Typography variant="caption" color="text.secondary">
                        {line.modifiers.map((modifier) => modifier.title).join(' · ')}
                      </Typography>
                    ) : null}
                    {line.comment ? (
                      <Typography variant="caption" color="text.secondary">
                        {t('guest.item.comment')}: {line.comment}
                      </Typography>
                    ) : null}
                    <Typography variant="body2">
                      {format(line.unit_price * line.quantity)}
                    </Typography>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <QuantityStepper
                        size="small"
                        code={line.item_code}
                        value={line.quantity}
                        min={1}
                        onIncrement={() => cart.setQuantity(line.uid, line.quantity + 1)}
                        onDecrement={() => cart.setQuantity(line.uid, line.quantity - 1)}
                      />
                      <IconButton
                        size="small"
                        aria-label={t('guest.cart.remove')}
                        data-testid={`guest-cart-remove-${line.item_code}`}
                        onClick={() => cart.removeLine(line.uid)}
                        sx={{ minWidth: 44, minHeight: 44 }}
                      >
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  </Stack>
                </Stack>
              ))}
            </Stack>
          </Paper>

          <Stack spacing={1}>
            <Typography variant="subtitle1">{t('guest.cart.where')}</Typography>
            {locationsQuery.isError ? (
              <Alert
                severity="error"
                action={
                  <Button color="inherit" size="small" onClick={() => void locationsQuery.refetch()}>
                    {t('guest.common.retry')}
                  </Button>
                }
              >
                {errorMessage(locationsQuery.error, t)}
              </Alert>
            ) : null}
            <Paper variant="outlined">
              <Stack divider={<Divider flexItem />}>
                {locations.map((location) => (
                  <FormControlLabel
                    key={location.id}
                    checked={draft.locationId === location.id}
                    onChange={() =>
                      setDraft((prev) => ({ ...prev, locationId: location.id, refinement: '' }))
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

          <Stack spacing={1}>
            <Typography variant="subtitle1">{t('guest.cart.when')}</Typography>
            <ToggleButtonGroup
              exclusive
              fullWidth
              color="primary"
              value={draft.timing}
              onChange={(_event, value: OrderTiming | null) => {
                if (value) setDraft((prev) => ({ ...prev, timing: value }));
              }}
            >
              <ToggleButton value="asap" data-testid="guest-timing-asap" sx={{ minHeight: 48 }}>
                {t('guest.cart.asap')}
              </ToggleButton>
              <ToggleButton
                value="scheduled"
                data-testid="guest-timing-scheduled"
                sx={{ minHeight: 48 }}
              >
                {t('guest.cart.scheduled')}
              </ToggleButton>
            </ToggleButtonGroup>
            {draft.timing === 'scheduled' ? (
              <TextField
                type="time"
                fullWidth
                label={t('guest.cart.time')}
                value={draft.time}
                onChange={(event) => setDraft((prev) => ({ ...prev, time: event.target.value }))}
                error={draft.showErrors && timeMissing}
                helperText={
                  draft.showErrors && timeMissing ? t('guest.errors.requestedTimeInvalid') : undefined
                }
                InputLabelProps={{ shrink: true }}
                inputProps={{ 'data-testid': 'guest-time-input' }}
              />
            ) : null}
          </Stack>

          <TextField
            fullWidth
            multiline
            minRows={2}
            label={t('guest.cart.comment')}
            placeholder={t('guest.cart.commentPlaceholder')}
            value={draft.comment}
            onChange={(event) => setDraft((prev) => ({ ...prev, comment: event.target.value }))}
            inputProps={{ maxLength: 300, 'data-testid': 'guest-order-comment' }}
          />

          <Stack direction="row" justifyContent="space-between" alignItems="baseline">
            <Typography variant="subtitle1">{t('guest.cart.total')}</Typography>
            <Typography variant="h6" data-testid="guest-cart-total">
              {format(cart.total)}
            </Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {t('guest.cart.totalHint')}
          </Typography>

          {failure ? (
            <Alert
              severity="error"
              data-testid="guest-order-error"
              action={
                isRetryableOrderError(failure) ? (
                  <Button color="inherit" size="small" onClick={() => mutation.mutate()}>
                    {t('guest.common.retry')}
                  </Button>
                ) : undefined
              }
            >
              {errorMessage(failure, t)}
              {fieldError ? ` (${fieldError})` : ''}
            </Alert>
          ) : null}
        </Stack>
      </Container>

      <StickyFooter offset={BOTTOM_NAV_HEIGHT}>
        <Button
          fullWidth
          size="large"
          variant="contained"
          disabled={!canOrder || mutation.isPending || !locations.length}
          onClick={submit}
          data-testid="guest-place-order"
          sx={{ minHeight: 52 }}
        >
          {mutation.isPending
            ? t('guest.cart.placing')
            : t('guest.cart.place', { price: format(cart.total) })}
        </Button>
      </StickyFooter>
    </Box>
  );
}
