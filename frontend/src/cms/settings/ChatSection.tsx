import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { api } from '@/api/client';
import { QueryState } from '@/components/QueryState';

/**
 * Чат: сколько гость ждёт ответа, прежде чем диалог краснеет у ресепшена и
 * уходит сигнал смене, а дальше — руководителю. Темп у курорта и у хостела
 * разный, поэтому это настройка отеля, а не число в коде.
 */
interface ChatSettings {
  reply_wait_minutes: number;
}

export function ChatSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const settings = useQuery({
    queryKey: ['cms', 'chat-settings'],
    queryFn: () => api.get<ChatSettings>('/cms/chat-settings'),
  });

  const save = useMutation({
    mutationFn: (patch: Partial<ChatSettings>) => api.patch<ChatSettings>('/cms/chat-settings', patch),
    onSuccess: (fresh) => {
      setError(null);
      queryClient.setQueryData(['cms', 'chat-settings'], fresh);
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : t('settings.chat.saveFailed')),
  });

  return (
    <Box data-testid="settings-chat">
      <Typography variant="h6" sx={{ mb: 0.5 }}>
        {t('settings.chat.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {t('settings.chat.subtitle')}
      </Typography>
      <QueryState query={settings} what={t('state.what.chatSettings')}>
        {(data) => (
          <Stack spacing={1.5} sx={{ maxWidth: 420 }}>
            <TextField
              type="number"
              size="small"
              label={t('settings.chat.wait')}
              defaultValue={data.reply_wait_minutes}
              onBlur={(event) => {
                const value = Number(event.target.value);
                if (value && value !== data.reply_wait_minutes) save.mutate({ reply_wait_minutes: value });
              }}
              helperText={t('settings.chat.waitHint')}
              inputProps={{ 'data-testid': 'chat-reply-wait', min: 1, max: 240 }}
            />
            {error ? (
              <Alert severity="error" data-testid="chat-settings-error" onClose={() => setError(null)}>
                {error}
              </Alert>
            ) : null}
          </Stack>
        )}
      </QueryState>
    </Box>
  );
}
