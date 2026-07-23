import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { useMoney } from '../hooks/useMoney';
import type { CartQuote } from '../api/types';

export interface CartTotalsProps {
  /** The server quote — the ONLY source of every charge and of the grand total. */
  quote: CartQuote | undefined;
  /** True on the very first quote, before any total has been received. */
  loading: boolean;
}

function ChargeRow({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId?: string;
}) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="baseline">
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" data-testid={testId}>
        {value}
      </Typography>
    </Stack>
  );
}

/**
 * The cart's money block. Every value is read straight from the server quote —
 * this component performs NO arithmetic on charges or on the total. A charge row
 * appears only when its amount is non-zero; when tax is inclusive it is shown as
 * an informational "в т.ч. НДС" note rather than an added line. `total_minor` is
 * displayed verbatim as the grand total.
 */
export function CartTotals({ quote, loading }: CartTotalsProps) {
  const { t } = useTranslation();
  const { format } = useMoney();

  return (
    <Stack spacing={0.75}>
      {quote ? (
        <>
          <ChargeRow label={t('guest.cart.subtotal')} value={format(quote.subtotal_minor)} />
          {quote.service_fee_minor !== 0 ? (
            <ChargeRow
              label={t('guest.cart.serviceFee')}
              value={format(quote.service_fee_minor)}
              testId="guest-cart-charge-fee"
            />
          ) : null}
          {quote.delivery_fee_minor !== 0 ? (
            <ChargeRow
              label={t('guest.cart.delivery')}
              value={format(quote.delivery_fee_minor)}
              testId="guest-cart-charge-delivery"
            />
          ) : null}
          {!quote.tax_inclusive && quote.tax_minor !== 0 ? (
            <ChargeRow
              label={t('guest.cart.tax')}
              value={format(quote.tax_minor)}
              testId="guest-cart-charge-tax"
            />
          ) : null}
          {quote.tip_minor !== 0 ? (
            <ChargeRow
              label={t('guest.cart.tip')}
              value={format(quote.tip_minor)}
              testId="guest-cart-charge-tip"
            />
          ) : null}
        </>
      ) : null}

      {/* Reference `.totals .fin` — a hairline, then the final total emphasised. */}
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="baseline"
        sx={{ pt: 1.5, mt: 0.75, borderTop: 1, borderColor: 'divider' }}
      >
        <Typography variant="subtitle1">{t('guest.cart.total')}</Typography>
        {quote ? (
          <Typography
            data-testid="guest-cart-total"
            sx={(theme) => ({
              fontFamily: theme.typography.h1.fontFamily,
              fontWeight: 800,
              fontSize: '1.0625rem',
            })}
          >
            {format(quote.total_minor)}
          </Typography>
        ) : loading ? (
          <Skeleton variant="text" width={84} data-testid="guest-cart-total" />
        ) : (
          <Typography data-testid="guest-cart-total" color="text.secondary">
            {t('guest.order.noPrice')}
          </Typography>
        )}
      </Stack>

      {/* Inclusive tax is already inside the prices — shown, not added again. */}
      {quote?.tax_inclusive && quote.tax_minor !== 0 ? (
        <Typography
          variant="caption"
          color="text.secondary"
          data-testid="guest-cart-charge-tax"
        >
          {t('guest.cart.taxInclusive', { amount: format(quote.tax_minor) })}
        </Typography>
      ) : null}

      <Typography variant="caption" color="text.secondary">
        {t('guest.cart.totalHint')}
      </Typography>
    </Stack>
  );
}
