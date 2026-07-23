import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { ctaGradientSx } from '@/kit';
import { EmptyState } from '@/components/EmptyState';
import { inputToMinor } from '@/utils/money';
import { ItemThumb } from '../components/ItemMeta';
import { QuantityStepper } from '../components/QuantityStepper';
import { StickyFooter } from '../components/StickyFooter';
import { TipSelector } from '../components/TipSelector';
import { CartTotals } from '../components/CartTotals';
import { errorMessage, isRetryableOrderError } from '../errors';
import { useCartQuote, useGuestLocations } from '../hooks/useGuestQueries';
import { useMoney } from '../hooks/useMoney';
import { useOrderSubmit } from '../hooks/useOrderSubmit';
import { BOTTOM_NAV_HEIGHT } from '../layout/GuestLayout';
import { useGuestSession } from '../session/GuestSessionProvider';
import { useCart } from '../state/cart';
import { useDraftState } from '@/state/useDraftState';
import type { CreateOrderPayload, OrderTiming } from '../api/types';

/** How the guest set the tip: none, a percentage preset, or a custom amount. */
type TipKind = 'none' | 'preset' | 'custom';

interface CheckoutDraft {
  locationId: string | null;
  refinement: string;
  timing: OrderTiming;
  /** "HH:MM" from the native time input. */
  time: string;
  comment: string;
  showErrors: boolean;
  tipKind: TipKind;
  /** Selected preset percent — only meaningful when `tipKind === 'preset'`. */
  tipPercent: number | null;
  /** Raw custom-amount input — only meaningful when `tipKind === 'custom'`. */
  tipCustom: string;
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
  const { format, minorUnits } = useMoney();
  const cart = useCart();
  const { canOrder } = useGuestSession();
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
      tipKind: 'none',
      tipPercent: null,
      tipCustom: '',
    }),
    locations.map((location) => location.id).join(','),
  );

  const selectedLocation = locations.find((location) => location.id === draft.locationId) ?? null;
  const needsRefinement = Boolean(selectedLocation?.requires_refinement);
  const refinementMissing = needsRefinement && !draft.refinement.trim();
  const timeMissing = draft.timing === 'scheduled' && !timeToIso(draft.time);

  // The guest's tip choice, resolved into the API's two mutually-exclusive fields:
  // a preset sends `tip_percent`, a positive custom amount sends `tip_minor`, and
  // "no tip" sends neither. The very same fields feed the quote and the order.
  const customTipMinor =
    draft.tipKind === 'custom' ? inputToMinor(draft.tipCustom, minorUnits) : null;
  const tipFields: Pick<CreateOrderPayload, 'tip_minor' | 'tip_percent'> =
    draft.tipKind === 'preset' && draft.tipPercent != null
      ? { tip_percent: draft.tipPercent }
      : draft.tipKind === 'custom' && customTipMinor != null && customTipMinor > 0
        ? { tip_minor: customTipMinor }
        : {};

  const payload = useMemo<CreateOrderPayload>(
    () => ({
      lines: cart.toPayloadLines(),
      location_id: draft.locationId ?? '',
      location_refinement: needsRefinement ? draft.refinement.trim() : '',
      delivery_mode: locationsQuery.data?.delivery_modes?.[0] ?? 'delivery',
      timing: draft.timing,
      requested_time: draft.timing === 'scheduled' ? timeToIso(draft.time) : null,
      comment: draft.comment.trim(),
      ...tipFields,
    }),
    [cart, draft, needsRefinement, locationsQuery.data, tipFields.tip_minor, tipFields.tip_percent],
  );

  // Server-priced cart — THE only source of every charge and of the grand total.
  // Re-quoted whenever the quote-relevant body (lines, location, delivery mode,
  // tip) changes; the client renders `quote.total_minor` verbatim and never sums
  // charges itself.
  const quoteSignature = JSON.stringify({
    lines: payload.lines,
    location_id: payload.location_id,
    delivery_mode: payload.delivery_mode,
    tip_minor: payload.tip_minor,
    tip_percent: payload.tip_percent,
  });
  const quoteQuery = useCartQuote(payload, quoteSignature, !cart.isEmpty && canOrder);
  const quote = quoteQuery.data;
  const belowMinimum = Boolean(quote?.below_minimum);

  // The same checkout the request form uses — one endpoint, one idempotency
  // discipline, one confirmation screen for both offering types.
  const { submit: place, isPending, failure } = useOrderSubmit(payload, {
    onPlaced: () => cart.clear(),
  });

  const submit = () => {
    if (!canOrder || belowMinimum) return;
    if (!draft.locationId || refinementMissing || timeMissing) {
      setDraft((prev) => ({ ...prev, showErrors: true }));
      return;
    }
    place();
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
              sx={(theme) => ({
                gap: '9px',
                '& .MuiToggleButton-root': {
                  border: `1.5px solid ${theme.palette.divider}`,
                  borderRadius: '12px !important',
                  fontWeight: 700,
                  color: 'text.secondary',
                },
                '& .MuiToggleButton-root.Mui-selected': {
                  borderColor: theme.palette.primary.main,
                  bgcolor: theme.palette.brand.primarySoft,
                  color: theme.palette.text.primary,
                  '&:hover': { bgcolor: theme.palette.brand.primarySoft },
                },
              })}
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

          {/* Tips — presets (percent) from the quote, a custom amount or none.
              The choice feeds BOTH the quote and the order body. */}
          <TipSelector
            presets={quote?.tip_presets ?? []}
            kind={draft.tipKind}
            percent={draft.tipPercent}
            custom={draft.tipCustom}
            onNone={() =>
              setDraft((prev) => ({ ...prev, tipKind: 'none', tipPercent: null }))
            }
            onPreset={(pct) =>
              setDraft((prev) => ({ ...prev, tipKind: 'preset', tipPercent: pct }))
            }
            onCustom={() => setDraft((prev) => ({ ...prev, tipKind: 'custom' }))}
            onCustomChange={(value) =>
              setDraft((prev) => ({ ...prev, tipKind: 'custom', tipCustom: value }))
            }
          />

          {/* Every charge line and the grand total come ONLY from the quote — the
              client never computes a charge or the total itself. */}
          <CartTotals quote={quote} loading={quoteQuery.isLoading} />

          {belowMinimum && quote ? (
            <Alert severity="warning" data-testid="guest-cart-below-minimum">
              {t('guest.cart.belowMinimum', { amount: format(quote.shortfall_minor) })}
            </Alert>
          ) : null}

          {quoteQuery.isError ? (
            <Alert
              severity="error"
              action={
                <Button color="inherit" size="small" onClick={() => void quoteQuery.refetch()}>
                  {t('guest.common.retry')}
                </Button>
              }
            >
              {t('guest.cart.quoteError')}
            </Alert>
          ) : null}

          {failure ? (
            <Alert
              severity="error"
              data-testid="guest-order-error"
              action={
                isRetryableOrderError(failure) ? (
                  <Button color="inherit" size="small" onClick={() => place()}>
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
          disabled={
            !canOrder || isPending || !locations.length || belowMinimum || quoteQuery.isLoading
          }
          onClick={submit}
          data-testid="guest-place-order"
          sx={[ctaGradientSx, { minHeight: 52 }]}
        >
          {isPending
            ? t('guest.cart.placing')
            : quote
              ? t('guest.cart.place', { price: format(quote.total_minor) })
              : t('guest.cart.placeShort')}
        </Button>
      </StickyFooter>
    </Box>
  );
}
