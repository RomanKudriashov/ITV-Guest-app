import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { ApiError } from '@/api/client';
import { fetchAccess, setDemoEntry, setRoomPin } from '@/api/grms';
import { useGrmsScope } from './scope';
import { queryKeys } from '@/api/queryKeys';
import { useToast } from '@/components/ToastProvider';

/**
 * Доступ гостя к управлению номером: PIN проживания и демо-вход.
 *
 * PIN НЕ ПОКАЗЫВАЕТСЯ никогда — в базе лежит только хэш. Ресепшен называет код
 * в момент заведения; «посмотреть, какой там был» — это уже не подтверждение
 * проживания, а список ключей от всех номеров.
 *
 * Предупреждение о демо-входе берётся С СЕРВЕРА и показывается рядом с самим
 * переключателем. Формулировка послабления не должна зависеть от того, какой
 * экран его показывает, — и от того, вспомнил ли о ней верстальщик.
 */
export function AccessTab() {
  const { t } = useTranslation();
  // База API — из области: CMS отеля или консоль платформы.
  const { transport } = useGrmsScope();
  const toast = useToast();
  const queryClient = useQueryClient();

  const query = useQuery({ queryKey: queryKeys.grmsAccess, queryFn: () => fetchAccess(transport) });

  const [room, setRoom] = useState('');
  const [pin, setPin] = useState('');

  const failure = (error: unknown) =>
    toast.show(error instanceof ApiError ? error.detail : t('errors.generic'), 'error');

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.grmsAccess });

  const demoMutation = useMutation({
    mutationFn: (enabled: boolean) => setDemoEntry(transport, enabled),
    onSuccess: () => void refresh(),
    onError: failure,
  });

  const pinMutation = useMutation({
    mutationFn: (payload: { room: string; pin: string }) => setRoomPin(transport, payload.room, payload.pin),
    onSuccess: (result) => {
      setPin('');
      void refresh();
      toast.show(
        result.has_pin ? t('roomControl.access.pinSet') : t('roomControl.access.pinCleared'),
        'success',
      );
    },
    onError: failure,
  });

  if (query.isLoading) return <Skeleton variant="rounded" height={320} />;
  if (query.isError || !query.data) {
    return <Alert severity="error">{t('roomControl.access.loadError')}</Alert>;
  }

  const state = query.data;

  return (
    <Stack spacing={2} data-testid="grms-access">
      {/* Объяснение вкладки — первым, до карточек с переключателями. */}
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 760 }} data-testid="grms-access-intro">
        {t('roomControl.access.intro')}
      </Typography>
      <Card variant="outlined" sx={{ borderColor: 'divider' }}>
        <CardContent>
          <Typography variant="subtitle1">{t('roomControl.access.pinTitle')}</Typography>
          <Typography variant="caption" color="text.secondary">
            {t('roomControl.access.pinHint')}
          </Typography>
          <Divider sx={{ my: 1.5 }} />

          {/*
            ПОЧЕМУ ТАБЛИЦА ГАСНЕТ. При включённом демо-входе `room_verified`
            возвращает true сразу — PIN не спрашивают ни у кого. Заведённый в
            этот момент код выглядел «активным» и не работал, а признака этого
            на экране не было ни одного. Гасим ВИД, а не возможность: к показу
            готовятся заранее, и завести код при включённом послаблении —
            нормальная работа ресепшена.
          */}
          {state.demo_entry.enabled ? (
            <Alert severity="warning" sx={{ mb: 2 }} data-testid="grms-pin-muted">
              {t('roomControl.access.pinMuted')}
            </Alert>
          ) : null}
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
            <TextField
              size="small"
              label={t('roomControl.builder.room')}
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              data-testid="grms-pin-room"
            />
            <TextField
              size="small"
              label={t('roomControl.access.pin')}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              data-testid="grms-pin-value"
            />
            <Button
              variant="contained"
              disabled={!room.trim() || !pin.trim() || pinMutation.isPending}
              onClick={() => pinMutation.mutate({ room: room.trim(), pin: pin.trim() })}
              data-testid="grms-pin-save"
            >
              {t('roomControl.access.pinSave')}
            </Button>
          </Stack>

          {state.pins.length === 0 ? (
            <Typography variant="caption" color="text.secondary">
              {t('roomControl.access.noPins')}
            </Typography>
          ) : (
            <Table size="small" sx={state.demo_entry.enabled ? { opacity: 0.5 } : undefined}>
              <TableHead>
                <TableRow>
                  <TableCell>{t('roomControl.builder.room')}</TableCell>
                  <TableCell>{t('roomControl.access.issuedAt')}</TableCell>
                  <TableCell>{t('roomControl.access.state')}</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {state.pins.map((record) => (
                  <TableRow key={record.room} data-testid={`grms-pin-${record.room}`}>
                    <TableCell>{record.room}</TableCell>
                    <TableCell>{new Date(record.issued_at).toLocaleString()}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={record.is_active ? 'success' : 'default'}
                        label={
                          record.is_active
                            ? t('roomControl.access.active')
                            : t('roomControl.access.inactive')
                        }
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        color="error"
                        disabled={pinMutation.isPending}
                        onClick={() => pinMutation.mutate({ room: record.room, pin: '' })}
                        data-testid={`grms-pin-clear-${record.room}`}
                      >
                        {t('roomControl.access.pinClear')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/*
        Демо-вход — ОТДЕЛЬНОЙ секцией и ниже PIN’ов, а не первой карточкой.
        Стоя вплотную над таблицей номеров, переключатель читался как настройка
        этих номеров; на деле это флаг ВСЕГО отеля — он живёт в
        `HotelModule.config`, а не у комнаты. Слово «отель» стоит в заголовке, а
        не только в тексте предупреждения, потому что заголовок читают всегда.
      */}
      <Card variant="outlined" sx={{ borderColor: 'divider' }} data-testid="grms-demo-section">
        <CardContent>
          <Typography variant="subtitle1">{t('roomControl.access.demoTitle')}</Typography>
          <Typography variant="caption" color="text.secondary">
            {t('roomControl.access.demoHint')}
          </Typography>
          <Divider sx={{ my: 1.5 }} />
          <FormControlLabel
            control={
              <Switch
                checked={state.demo_entry.enabled}
                onChange={(e) => demoMutation.mutate(e.target.checked)}
                data-testid="grms-demo-entry"
              />
            }
            label={t('roomControl.access.demoLabel')}
          />
          {/*
            Кто и когда трогал. Послабление держится, пока его не выключат, —
            значит вопрос задают не в день включения, а неделю спустя, и ответ
            «спросите в журнале платформы» здесь не работает.
          */}
          {state.demo_entry.toggled ? (
            <Typography
              variant="caption"
              color="text.secondary"
              display="block"
              sx={{ mt: 0.5 }}
              data-testid="grms-demo-toggled"
            >
              {t(
                state.demo_entry.toggled.enabled
                  ? 'roomControl.access.demoToggledOn'
                  : 'roomControl.access.demoToggledOff',
                {
                  who: state.demo_entry.toggled.by || t('roomControl.access.demoSomeone'),
                  when: new Date(state.demo_entry.toggled.at).toLocaleString(),
                },
              )}
            </Typography>
          ) : null}
          {/* Текст предупреждения — с сервера, дословно. */}
          <Alert
            severity={state.demo_entry.enabled ? 'warning' : 'info'}
            sx={{ mt: 1 }}
            data-testid="grms-demo-warning"
          >
            <AlertTitle>{t('roomControl.access.demoWarningTitle')}</AlertTitle>
            {state.demo_entry.warning}
          </Alert>
        </CardContent>
      </Card>
    </Stack>
  );
}
