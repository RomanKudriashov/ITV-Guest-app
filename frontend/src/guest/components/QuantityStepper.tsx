import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { useTranslation } from 'react-i18next';

import { pressableSx } from '@/kit';

export interface QuantityStepperProps {
  value: number;
  onIncrement: () => void;
  onDecrement: () => void;
  /** Suffix of the testids: `guest-qty-plus-<code>` / `guest-qty-minus-<code>`. */
  code: string;
  /** Shows a bin icon instead of the minus when the value would drop to zero. */
  removeAtZero?: boolean;
  min?: number;
  max?: number;
  size?: 'small' | 'medium';
}

/** Touch target is 44px per the accessibility floor. */
const TOUCH = 44;

export function QuantityStepper({
  value,
  onIncrement,
  onDecrement,
  code,
  removeAtZero = false,
  min = 0,
  max = 99,
  size = 'medium',
}: QuantityStepperProps) {
  const { t } = useTranslation();
  const showBin = removeAtZero && value <= 1;

  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        borderRadius: 999,
        border: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
    >
      <IconButton
        size={size}
        aria-label={showBin ? t('guest.cart.remove') : t('guest.menu.decrease')}
        data-testid={`guest-qty-minus-${code}`}
        disabled={value <= min}
        onClick={onDecrement}
        sx={[{ minWidth: TOUCH, minHeight: TOUCH }, pressableSx]}
      >
        {showBin ? <DeleteOutlineIcon fontSize="small" /> : <RemoveIcon fontSize="small" />}
      </IconButton>
      <Typography
        component="span"
        variant="body2"
        aria-live="polite"
        sx={{ minWidth: 24, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </Typography>
      <IconButton
        size={size}
        aria-label={t('guest.menu.increase')}
        data-testid={`guest-qty-plus-${code}`}
        disabled={value >= max}
        onClick={onIncrement}
        sx={[{ minWidth: TOUCH, minHeight: TOUCH }, pressableSx]}
      >
        <AddIcon fontSize="small" />
      </IconButton>
    </Box>
  );
}
