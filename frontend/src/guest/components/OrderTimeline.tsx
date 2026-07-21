import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CheckIcon from '@mui/icons-material/Check';
import { useTranslation } from 'react-i18next';

import type { GuestOrder } from '../api/types';

function formatTime(iso: string, language: string): string {
  try {
    return new Intl.DateTimeFormat(language, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

/**
 * Timeline built from `status_flow` + `history`, both of which travel with the
 * order — no second request and no hard-coded status preset on the client.
 */
export function OrderTimeline({ order }: { order: GuestOrder }) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language ?? 'en';

  const historyByCode = new Map(order.history.map((entry) => [entry.code, entry]));
  const currentIndex = order.status_flow.findIndex((step) => step.code === order.status.code);

  // A cancelled order left the happy path: show what happened, not what would have.
  const steps = order.status.is_cancelled
    ? order.history.map((entry, index) => ({
        code: entry.code,
        title: entry.title,
        at: entry.at,
        done: true,
        current: index === order.history.length - 1,
      }))
    : order.status_flow
        .filter((step) => !step.is_cancelled)
        .map((step, index) => ({
          code: step.code,
          title: step.title,
          at: historyByCode.get(step.code)?.at,
          done: currentIndex >= 0 && index <= currentIndex,
          current: step.code === order.status.code,
        }));

  return (
    <Stack spacing={0} data-testid="guest-order-timeline" role="list">
      {steps.map((step, index) => (
        <Stack key={`${step.code}-${index}`} direction="row" spacing={1.5} role="listitem">
          <Stack alignItems="center" sx={{ width: 28 }}>
            <Box
              sx={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                bgcolor: step.done ? 'primary.main' : 'brand.surfaceMuted',
                color: step.done ? 'primary.contrastText' : 'text.secondary',
                border: step.current ? 2 : 0,
                borderColor: 'primary.main',
                flexShrink: 0,
              }}
            >
              {step.done ? <CheckIcon sx={{ fontSize: 14 }} /> : null}
            </Box>
            {index < steps.length - 1 ? (
              <Box
                sx={{
                  width: 2,
                  flexGrow: 1,
                  minHeight: 24,
                  bgcolor: step.done ? 'primary.main' : 'divider',
                }}
              />
            ) : null}
          </Stack>
          <Stack sx={{ pb: index < steps.length - 1 ? 2 : 0 }}>
            <Typography
              variant="body2"
              color={step.current ? 'text.primary' : step.done ? 'text.primary' : 'text.secondary'}
              sx={{ fontWeight: step.current ? 600 : 400 }}
            >
              {step.title}
            </Typography>
            {step.at ? (
              <Typography variant="caption" color="text.secondary">
                {formatTime(step.at, language)}
              </Typography>
            ) : step.current ? (
              <Typography variant="caption" color="text.secondary">
                {t('guest.order.inProgress')}
              </Typography>
            ) : null}
          </Stack>
        </Stack>
      ))}
    </Stack>
  );
}
