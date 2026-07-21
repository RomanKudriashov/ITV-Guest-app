import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import type { OrderFieldValue } from '../api/types';

export interface OrderFieldValuesProps {
  values: OrderFieldValue[];
  testId?: string;
  dense?: boolean;
}

/**
 * The body of a request order: the answers to its form, label + display.
 *
 * Shared by the storefront and the tracker on purpose — a cook and a guest look
 * at the same snapshot, and `display` is already formatted by the server, so
 * neither side re-formats an answer of its own accord.
 */
export function OrderFieldValues({ values, testId, dense }: OrderFieldValuesProps) {
  if (!values.length) return null;
  return (
    <Stack spacing={dense ? 0.25 : 0.75} data-testid={testId}>
      {values.map((entry) => (
        <Stack
          key={entry.code}
          direction="row"
          justifyContent="space-between"
          spacing={2}
          alignItems="baseline"
        >
          <Typography variant={dense ? 'caption' : 'body2'} color="text.secondary">
            {entry.label}
          </Typography>
          <Typography
            variant={dense ? 'caption' : 'body2'}
            sx={{ textAlign: 'end', minWidth: 0 }}
          >
            {entry.display}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}
