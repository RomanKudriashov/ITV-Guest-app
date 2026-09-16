import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import {
  fetchOwnContacts,
  requestBindingCode,
  saveOwnPhone,
  unlinkMessenger,
  type BindingCode,
  type Messenger,
  type OwnContacts,
} from '@/api/cms';
import { ApiError } from '@/api/client';
import { QueryState } from '@/components/QueryState';
import { useToast } from '@/components/ToastProvider';

const KEY = ['staff', 'me', 'contacts'] as const;
const MESSENGERS: Messenger[] = ['telegram', 'max'];

/**
 * Свои контакты: телефон и мессенджеры.
 *
 * «Подключить» работает только там, где есть бот. Пока бота нет, кнопка
 * выключена и прямо говорит почему — рисовать рабочей заглушку нельзя: человек
 * нажал бы, ничего бы не случилось, и уведомления он ждал бы напрасно.
 */
export function ContactsPanel() {
  const { t } = useTranslation();
  const query = useQuery({ queryKey: KEY, queryFn: fetchOwnContacts });

  return (
    <Stack spacing={2} data-testid="profile-contacts">
      <Stack spacing={0.5}>
        <Typography variant="h6">{t('profile.contacts.title')}</Typography>
        <Typography variant="body2" color="text.secondary">
          {t('profile.contacts.hint')}
        </Typography>
      </Stack>
      <QueryState query={query} what={t('profile.contacts.what')}>
        {(contacts) => (
          <Stack spacing={2}>
            <PhoneRow key={contacts.phone} phone={contacts.phone} />
            <Divider />
            {MESSENGERS.map((messenger) => (
              <MessengerRow key={messenger} messenger={messenger} contacts={contacts} />
            ))}
          </Stack>
        )}
      </QueryState>
    </Stack>
  );
}

function PhoneRow({ phone }: { phone: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [value, setValue] = useState(phone);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => saveOwnPhone(value),
    onSuccess: (saved) => {
      setError(null);
      queryClient.setQueryData(KEY, saved);
      toast.show(t('profile.contacts.phoneSaved'), 'success');
    },
    onError: (failure) => {
      if (failure instanceof ApiError && failure.code === 'invalid_phone') {
        setError(t('profile.contacts.invalidPhone'));
        return;
      }
      setError(failure instanceof ApiError ? failure.detail : t('errors.generic'));
    },
  });

  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'flex-start' }}>
      <TextField
        size="small"
        type="tel"
        label={t('profile.contacts.phone')}
        value={value}
        placeholder="+7 900 000-00-00"
        onChange={(event) => {
          setError(null);
          setValue(event.target.value);
        }}
        error={Boolean(error)}
        helperText={error ?? t('profile.contacts.phoneHint')}
        inputProps={{ 'data-testid': 'profile-phone' }}
        sx={{ flex: 1 }}
      />
      <Button
        variant="outlined"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending || value.trim() === phone}
        data-testid="profile-phone-save"
        sx={{ minHeight: 40 }}
      >
        {t('common.save')}
      </Button>
    </Stack>
  );
}

function MessengerRow({ messenger, contacts }: { messenger: Messenger; contacts: OwnContacts }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const state = contacts.messengers[messenger];
  const [code, setCode] = useState<BindingCode | null>(null);

  const issue = useMutation({
    mutationFn: () => requestBindingCode(messenger),
    onSuccess: setCode,
    onError: (failure) =>
      toast.show(failure instanceof ApiError ? failure.detail : t('errors.generic'), 'error'),
  });
  const unlink = useMutation({
    mutationFn: () => unlinkMessenger(messenger),
    onSuccess: (saved) => {
      queryClient.setQueryData(KEY, saved);
      toast.show(t('profile.contacts.unlinked'), 'success');
    },
  });

  const confirmed = state.confirmed_at
    ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(
        new Date(state.confirmed_at),
      )
    : '';

  return (
    <Box data-testid={`profile-messenger-${messenger}`}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        alignItems={{ sm: 'center' }}
        justifyContent="space-between"
      >
        <Stack spacing={0.25}>
          <Typography variant="subtitle2">{t(`profile.contacts.messengers.${messenger}`)}</Typography>
          {state.linked ? (
            <Chip
              size="small"
              color="success"
              label={t('profile.contacts.confirmed', {
                date: confirmed,
                who: state.username ? ` · @${state.username}` : '',
              })}
              data-testid={`profile-messenger-${messenger}-linked`}
              sx={{ alignSelf: 'flex-start' }}
            />
          ) : (
            <Typography variant="body2" color="text.secondary">
              {t('profile.contacts.notLinked')}
            </Typography>
          )}
        </Stack>
        {state.linked ? (
          <Button
            color="inherit"
            onClick={() => unlink.mutate()}
            disabled={unlink.isPending}
            data-testid={`profile-messenger-${messenger}-unlink`}
          >
            {t('profile.contacts.unlink')}
          </Button>
        ) : (
          <Button
            variant="contained"
            onClick={() => issue.mutate()}
            disabled={!state.binding_available || issue.isPending}
            data-testid={`profile-messenger-${messenger}-connect`}
          >
            {t('profile.contacts.connect')}
          </Button>
        )}
      </Stack>
      {!state.linked && !state.binding_available ? (
        <Alert
          severity="info"
          sx={{ mt: 1 }}
          data-testid={`profile-messenger-${messenger}-unavailable`}
        >
          {t('profile.contacts.unavailable')}
        </Alert>
      ) : null}
      {code ? (
        <Alert severity="success" sx={{ mt: 1 }} data-testid={`profile-messenger-${messenger}-code`}>
          {code.link ? (
            <Link href={code.link} target="_blank" rel="noopener noreferrer">
              {t('profile.contacts.openBot')}
            </Link>
          ) : (
            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
              {code.code}
            </Typography>
          )}
          <Typography variant="caption" sx={{ display: 'block' }}>
            {t('profile.contacts.codeExpires', {
              time: new Intl.DateTimeFormat(i18n.language, { timeStyle: 'short' }).format(
                new Date(code.expires_at),
              ),
            })}
          </Typography>
        </Alert>
      ) : null}
    </Box>
  );
}
