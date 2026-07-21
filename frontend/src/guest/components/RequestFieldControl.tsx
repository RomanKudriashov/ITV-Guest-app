import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { fieldSpec } from '@/offerings/requestFields';
import { QuantityStepper } from './QuantityStepper';
import type { RequestField } from '../api/types';

export interface RequestFieldControlProps {
  field: RequestField;
  value: string;
  error?: string | null;
  onChange: (value: string) => void;
  onBlur: () => void;
}

/**
 * One answer control. Which widget to draw is decided by the field-type table
 * (`@/offerings/requestFields`), not by a chain of conditions in the form — the
 * form only lays the controls out.
 */
export function RequestFieldControl({
  field,
  value,
  error,
  onChange,
  onBlur,
}: RequestFieldControlProps) {
  const { t } = useTranslation();
  const spec = fieldSpec(field.field_type);
  const testId = `guest-field-${field.code}`;
  const helperText = error ?? field.help_text ?? undefined;
  const label = field.is_required ? `${field.label} *` : field.label;

  if (spec.control === 'stepper') {
    const min = typeof field.min_value === 'number' ? field.min_value : 0;
    const max = typeof field.max_value === 'number' ? field.max_value : 99;
    const current = Number(value || min);
    return (
      <Stack spacing={0.5} data-testid={testId}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
          <Typography variant="body1">{label}</Typography>
          <QuantityStepper
            code={`field-${field.code}`}
            value={Number.isFinite(current) ? current : min}
            min={min}
            max={max}
            onIncrement={() => onChange(String(Math.min(max, current + 1)))}
            onDecrement={() => onChange(String(Math.max(min, current - 1)))}
          />
        </Stack>
        {helperText ? (
          <Typography variant="caption" color={error ? 'error.main' : 'text.secondary'}>
            {helperText}
          </Typography>
        ) : null}
      </Stack>
    );
  }

  const common = {
    fullWidth: true,
    label,
    value,
    error: Boolean(error),
    helperText,
    onChange: (event: { target: { value: string } }) => onChange(event.target.value),
    onBlur,
  };

  if (spec.control === 'select') {
    return (
      // A native select on purpose: the phone opens its own wheel picker, and
      // the testid lands on a real <select> the tests can drive.
      <TextField
        {...common}
        select
        SelectProps={{ native: true }}
        InputLabelProps={{ shrink: true }}
        inputProps={{ 'data-testid': testId }}
      >
        <option value="">{t('guest.request.selectPlaceholder')}</option>
        {(field.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </TextField>
    );
  }

  const numericBounds =
    spec.supportsBounds
      ? {
          min: typeof field.min_value === 'number' ? field.min_value : undefined,
          max: typeof field.max_value === 'number' ? field.max_value : undefined,
        }
      : {};

  return (
    <TextField
      {...common}
      type={spec.control === 'text' ? 'text' : spec.control}
      multiline={spec.control === 'text'}
      minRows={spec.control === 'text' ? 1 : undefined}
      InputLabelProps={
        spec.control === 'date' || spec.control === 'time' ? { shrink: true } : undefined
      }
      inputProps={{
        'data-testid': testId,
        maxLength: spec.control === 'text' ? 300 : undefined,
        inputMode: spec.control === 'number' ? 'decimal' : undefined,
        ...numericBounds,
      }}
    />
  );
}
