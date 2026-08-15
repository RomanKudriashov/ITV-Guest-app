import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { ink, panelSx, primaryButtonSx, state, surface } from '../adminTokens';
import { QueryState } from '@/components/QueryState';
import { getMe, totpDisable, totpEnable, totpSetup } from '../adminClient';

/**
 * Второй фактор СВОЕЙ учётки платформы.
 *
 * Бэкенд умел это с самого начала — три ручки `/auth/2fa/*` без единого
 * экрана: включить второй фактор можно было, только выставив секрет в базе
 * руками. Экран команды при этом честно показывал колонку «2FA» и у половины
 * строк — прочерк, который никто не мог убрать.
 *
 * ЧУЖОЙ ФАКТОР ОТСЮДА НЕ ТРОГАЕТСЯ. Ручки работают с текущим пользователем, и
 * это правильно: включить второй фактор за другого нельзя (у него в руках свой
 * телефон), а выключить за другого — это способ снять с чужой учётки защиту,
 * и такая дверь должна открываться отдельным решением, а не кнопкой в списке.
 */
export function SecurityPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ['admin', 'me'], queryFn: getMe });

  const [secret, setSecret] = useState<string | null>(null);
  const [otpauth, setOtpauth] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['admin', 'me'] });

  const start = useMutation({
    mutationFn: totpSetup,
    onSuccess: (data) => {
      setSecret(data.secret);
      setOtpauth(data.otpauth_url);
      setError(null);
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : t('admin.security.setupFailed')),
  });

  const enable = useMutation({
    mutationFn: () => totpEnable(code.trim()),
    onSuccess: () => {
      // Секрет с экрана убираем сразу: показывать его после включения незачем,
      // а оставлять на виду — лишний риск.
      setSecret(null);
      setOtpauth(null);
      setCode('');
      setError(null);
      setDone(t('admin.security.enabled'));
      refresh();
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : t('admin.security.codeRejected')),
  });

  const disable = useMutation({
    mutationFn: totpDisable,
    onSuccess: () => {
      setDone(t('admin.security.disabled'));
      setError(null);
      refresh();
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : t('admin.security.disableFailed')),
  });

  return (
    <Box data-testid="admin-security">
      <Typography sx={{ fontSize: 24, fontWeight: 800, letterSpacing: '-.02em' }}>
        {t('admin.security.title')}
      </Typography>
      <Typography sx={{ color: ink.low, fontSize: 13, mt: 0.5 }}>
        {t('admin.security.subtitle')}
      </Typography>

      <QueryState query={me} what={t('state.what.me')}>
        {(user) => (
          <Box sx={{ ...panelSx, mt: 2.25, maxWidth: 560 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{user.email}</Typography>
            <Typography
              sx={{
                fontSize: 12.5,
                color: user.totp_enabled ? state.ok : state.warn,
                mt: 0.5,
                mb: 1.75,
              }}
              data-testid="admin-security-status"
            >
              {user.totp_enabled ? t('admin.security.on') : t('admin.security.off')}
            </Typography>

            {error ? (
              <Alert severity="error" sx={{ mb: 1.5 }} data-testid="admin-security-error">
                {error}
              </Alert>
            ) : null}
            {done ? (
              <Alert severity="success" sx={{ mb: 1.5 }} data-testid="admin-security-done">
                {done}
              </Alert>
            ) : null}

            {user.totp_enabled ? (
              <Button
                onClick={() => disable.mutate()}
                disabled={disable.isPending}
                data-testid="admin-security-disable"
                sx={{ color: state.bad, border: `1px solid ${state.bad}55` }}
              >
                {t('admin.security.disable')}
              </Button>
            ) : secret ? (
              <>
                {/*
                  Секрет показывается один раз и переносится в приложение
                  руками: QR здесь был бы удобнее, но тянуть ради него
                  библиотеку в бандл консоли — плата не по размеру задачи.
                  Строка `otpauth://` вставляется в приложение целиком.
                */}
                <Typography sx={{ fontSize: 12, color: ink.low, mb: 0.75 }}>
                  {t('admin.security.secretHint')}
                </Typography>
                <Box
                  sx={{
                    p: 1.25,
                    border: `1px solid ${surface.line}`,
                    borderRadius: 1,
                    fontFamily: 'monospace',
                    fontSize: 13,
                    wordBreak: 'break-all',
                    mb: 1.5,
                  }}
                  data-testid="admin-security-secret"
                >
                  {secret}
                  {otpauth ? (
                    <Typography sx={{ fontSize: 11, color: ink.low, mt: 0.75 }}>
                      {otpauth}
                    </Typography>
                  ) : null}
                </Box>
                <TextField
                  size="small"
                  label={t('admin.security.code')}
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputProps={{ 'data-testid': 'admin-security-code', inputMode: 'numeric' }}
                  sx={{ width: 180 }}
                />
                <Box sx={{ mt: 1.25 }}>
                  <Button
                    sx={primaryButtonSx}
                    disabled={code.trim().length < 6 || enable.isPending}
                    onClick={() => enable.mutate()}
                    data-testid="admin-security-confirm"
                  >
                    {t('admin.security.confirm')}
                  </Button>
                </Box>
              </>
            ) : (
              <Button
                sx={primaryButtonSx}
                onClick={() => start.mutate()}
                disabled={start.isPending}
                data-testid="admin-security-enable"
              >
                {t('admin.security.enable')}
              </Button>
            )}
          </Box>
        )}
      </QueryState>
    </Box>
  );
}
