import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { currencySymbol } from '@/utils/money';
import { useMoney } from '../hooks/useMoney';
import { useGuestLanguage } from '../hooks/useGuestQueries';

export type TipKind = 'none' | 'preset' | 'custom';

export interface TipSelectorProps {
  /** Percentage presets from the quote, e.g. `[5, 10, 15]`. */
  presets: number[];
  kind: TipKind;
  percent: number | null;
  custom: string;
  onNone: () => void;
  onPreset: (percent: number) => void;
  onCustom: () => void;
  onCustomChange: (value: string) => void;
}

/**
 * The checkout tip control. A preset is a percentage (feeds the quote/order as
 * `tip_percent`); the custom field is a plain amount (feeds them as `tip_minor`);
 * "no tip" sends neither. The control itself computes no charge — it only records
 * the guest's choice, which the quote then turns into an amount.
 */
export function TipSelector({
  presets,
  kind,
  percent,
  custom,
  onNone,
  onPreset,
  onCustom,
  onCustomChange,
}: TipSelectorProps) {
  const { t } = useTranslation();
  const { currency } = useMoney();
  const language = useGuestLanguage();

  // Single exclusive group over none / each preset / custom. The value encodes
  // the preset percent (`p:10`) so one control drives all three tip kinds.
  const value = kind === 'none' ? 'none' : kind === 'custom' ? 'custom' : `p:${percent}`;

  return (
    <Stack spacing={1}>
      <Typography variant="subtitle1">{t('guest.cart.tipTitle')}</Typography>
      <ToggleButtonGroup
        exclusive
        color="primary"
        value={value}
        onChange={(_event, next: string | null) => {
          if (!next) return;
          if (next === 'none') onNone();
          else if (next === 'custom') onCustom();
          else onPreset(Number(next.slice(2)));
        }}
        sx={(theme) => ({
          flexWrap: 'wrap',
          gap: '9px',
          '& .MuiToggleButton-root': {
            border: `1.5px solid ${theme.palette.divider}`,
            borderRadius: '12px !important',
            fontWeight: 700,
            color: 'text.secondary',
            px: 2,
            minHeight: 44,
          },
          '& .MuiToggleButton-root.Mui-selected': {
            borderColor: theme.palette.primary.main,
            bgcolor: theme.palette.brand.primarySoft,
            color: theme.palette.text.primary,
            '&:hover': { bgcolor: theme.palette.brand.primarySoft },
          },
        })}
      >
        <ToggleButton value="none" data-testid="guest-tip-none">
          {t('guest.cart.tipNone')}
        </ToggleButton>
        {presets.map((pct) => (
          <ToggleButton key={pct} value={`p:${pct}`} data-testid={`guest-tip-preset-${pct}`}>
            {t('guest.cart.tipPercent', { percent: pct })}
          </ToggleButton>
        ))}
        <ToggleButton value="custom" data-testid="guest-tip-custom">
          {t('guest.cart.tipCustom')}
        </ToggleButton>
      </ToggleButtonGroup>
      {kind === 'custom' ? (
        <TextField
          fullWidth
          label={t('guest.cart.tipCustomLabel')}
          value={custom}
          onChange={(event) => onCustomChange(event.target.value)}
          inputProps={{
            inputMode: 'decimal',
            'data-testid': 'guest-tip-custom-input',
            'aria-label': t('guest.cart.tipCustomLabel'),
          }}
          InputProps={{ endAdornment: currencySymbol(currency, language) }}
        />
      ) : null}
    </Stack>
  );
}
