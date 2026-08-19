import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { ink, primaryButtonSx, quietButtonSx, state, typo } from './adminTokens';
import { AdminDialog, Field, FormCell, FormGrid } from './form';
import { enterHotel, PlatformError, type EnterResult } from './adminClient';

const TTL_CHOICES = [15, 30, 60];

/**
 * Вход в отель от лица платформы.
 *
 * Причина обязательна, а срок конечен — и то и другое не формальность. Журнал
 * без причины отвечает «кто и когда», но не «зачем», а разбирают инциденты
 * именно по «зачем». Бессрочный же доступ ко всем данным отеля — это не вход
 * поддержки, а второй постоянный владелец отеля.
 */
export function EnterHotelDialog({
  hotelId,
  hotelName,
  onClose,
}: {
  hotelId: string;
  hotelName: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [ttl, setTtl] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [granted, setGranted] = useState<EnterResult | null>(null);

  const enter = useMutation({
    mutationFn: () => enterHotel(hotelId, { reason: reason.trim(), ttl_minutes: ttl }),
    onSuccess: setGranted,
    onError: (e) => setError(e instanceof PlatformError ? e.message : t('admin.enter.failed')),
  });

  if (granted) {
    return <GrantedView granted={granted} hotelName={hotelName} onClose={onClose} />;
  }

  return (
    <AdminDialog
      testId="admin-enter-dialog"
      title={t('admin.enter.title', { hotel: hotelName })}
      subtitle={t('admin.enter.hint')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose} sx={quietButtonSx}>
            {t('admin.actions.cancel')}
          </Button>
          <Button
            disabled={reason.trim().length < 3 || enter.isPending}
            onClick={() => enter.mutate()}
            data-testid="admin-enter-submit"
            sx={primaryButtonSx}
          >
            {t('admin.enter.submit')}
          </Button>
        </>
      }
    >
      <FormGrid>
        {error ? (
          <FormCell>
            <Alert severity="error" data-testid="admin-enter-error">
              {error}
            </Alert>
          </FormCell>
        ) : null}
        <Field
          span={12}
          label={t('admin.enter.reason')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          multiline
          minRows={2}
          inputProps={{ 'data-testid': 'admin-enter-reason' }}
        />
        <Field
          span={6}
          select
          label={t('admin.enter.ttl')}
          value={ttl}
          onChange={(e) => setTtl(Number(e.target.value))}
          SelectProps={{ inputProps: { 'data-testid': 'admin-enter-ttl' } }}
        >
          {TTL_CHOICES.map((minutes) => (
            <MenuItem key={minutes} value={minutes}>
              {t('admin.enter.minutes', { minutes })}
            </MenuItem>
          ))}
        </Field>
      </FormGrid>
    </AdminDialog>
  );
}

function GrantedView({
  granted,
  hotelName,
  onClose,
}: {
  granted: EnterResult;
  hotelName: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [left, setLeft] = useState(() => secondsLeft(granted.expires_at));

  // Таймер идёт на глазах: доступ ко всему отелю не должен тихо висеть, пока
  // о нём забыли. Когда время вышло, это видно здесь, а не только на сервере.
  useEffect(() => {
    const timer = window.setInterval(() => setLeft(secondsLeft(granted.expires_at)), 1000);
    return () => window.clearInterval(timer);
  }, [granted.expires_at]);

  const expired = left <= 0;

  return (
    <AdminDialog
      testId="admin-enter-granted"
      title={t('admin.enter.grantedTitle', { hotel: hotelName })}
      subtitle={t('admin.enter.asUser', { email: granted.as_user })}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose} sx={quietButtonSx}>
            {t('admin.actions.done')}
          </Button>
          <Button
            disabled={expired}
            onClick={() => {
              // Код уходит в ХЭШ-ФРАГМЕНТЕ, а не в строке запроса. Фрагмент
              // браузер вообще не отправляет на сервер: его нет ни в логах
              // прокси, ни в `Referer`. CMS обменяет его на токен запросом с
              // телом и сразу вычистит из истории.
              //
              // Сам код одноразовый и живёт минуту: даже утёкший, повторно он
              // сессии не откроет.
              const url = `${granted.cms_url}#support=${encodeURIComponent(granted.code)}`;
              window.open(url, '_blank', 'noreferrer');
            }}
            data-testid="admin-enter-open"
            sx={primaryButtonSx}
          >
            {t('admin.enter.open')}
          </Button>
        </>
      }
    >
      <Stack spacing={1.75}>
        {/*
          Таймер — крупным числом и в дисплейной гарнитуре: это единственное,
          ради чего экран открыт после выдачи доступа.
        */}
        <Typography
          data-testid="admin-enter-timer"
          sx={{ ...typo.metric, fontSize: 24, color: expired ? state.bad : state.warn }}
        >
          {expired ? t('admin.enter.expired') : t('admin.enter.left', { time: format(left) })}
        </Typography>
        <Alert severity="info" data-testid="admin-enter-audited">
          {t('admin.enter.audited')}
        </Alert>
        <Box sx={{ ...typo.caption, color: ink.low, wordBreak: 'break-all' }}>
          {granted.cms_url}
        </Box>
      </Stack>
    </AdminDialog>
  );
}

function secondsLeft(iso: string): number {
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 1000));
}

function format(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
