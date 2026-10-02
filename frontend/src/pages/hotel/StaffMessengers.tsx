import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { ApiError } from '@/api/client';
import { inviteToTelegram } from '@/api/hotelAdmin';
import type { StaffMember } from '@/api/hotelAdminTypes';
import { useToast } from '@/components/ToastProvider';

/**
 * Messengers on a staff row (batch 28).
 *
 * Everyone who sees the row sees whether Telegram/Max is connected. The hotel
 * admin also gets the delivery outcome — last delivery, last error, «bot
 * blocked» — and an invitation by e-mail for those not connected yet. The
 * delivery fields come from the server only for the admin, so their presence
 * is what tells the two views apart.
 */
export function StaffMessengers({ member }: { member: StaffMember }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const telegram = member.messengers?.telegram;
  const max = member.messengers?.max;
  const adminView = telegram !== undefined && 'last_sent_at' in telegram;

  const invite = useMutation({
    mutationFn: () => inviteToTelegram(member.id),
    onSuccess: (sent) => toast.show(t('hotel.staff.telegram.invited', { email: sent.delivered_to }), 'success'),
    onError: (failure) =>
      toast.show(failure instanceof ApiError ? failure.detail : t('errors.generic'), 'error'),
  });

  if (!member.messengers) return null;
  const when = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
  // The error is news only if it came after the last successful delivery.
  const freshError =
    telegram?.last_error_at &&
    (!telegram.last_sent_at || new Date(telegram.last_error_at) > new Date(telegram.last_sent_at));

  return (
    <Stack spacing={0.25} sx={{ mt: 0.25 }} data-testid={`staff-messengers-${member.email}`}>
      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
        {telegram?.linked ? (
          <Chip
            size="small"
            variant="outlined"
            color="success"
            label={t('profile.contacts.messengers.telegram')}
            data-testid={`staff-messenger-${member.email}-telegram`}
          />
        ) : null}
        {telegram?.linked && telegram.blocked ? (
          <Chip
            size="small"
            color="error"
            label={t('hotel.staff.telegram.blocked')}
            data-testid={`staff-telegram-blocked-${member.email}`}
          />
        ) : null}
        {max?.linked ? (
          <Chip
            size="small"
            variant="outlined"
            color="success"
            label={t('profile.contacts.messengers.max')}
            data-testid={`staff-messenger-${member.email}-max`}
          />
        ) : null}
        {adminView && !telegram?.linked ? (
          <Button
            size="small"
            variant="text"
            onClick={() => invite.mutate()}
            disabled={invite.isPending}
            data-testid={`staff-telegram-invite-${member.email}`}
            sx={{ minHeight: 0, py: 0, px: 0.5 }}
          >
            {t('hotel.staff.telegram.invite')}
          </Button>
        ) : null}
      </Stack>
      {adminView && telegram?.linked ? (
        <Typography variant="caption" color="text.secondary" data-testid={`staff-telegram-last-${member.email}`}>
          {telegram.last_sent_at
            ? t('hotel.staff.telegram.lastSent', { time: when(telegram.last_sent_at) })
            : t('hotel.staff.telegram.neverSent')}
        </Typography>
      ) : null}
      {adminView && telegram?.linked && freshError ? (
        <Typography variant="caption" color="error" data-testid={`staff-telegram-error-${member.email}`}>
          {t('hotel.staff.telegram.lastError', {
            time: when(telegram.last_error_at as string),
            error: telegram.last_error,
          })}
        </Typography>
      ) : null}
    </Stack>
  );
}
