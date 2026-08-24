import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { ApiError } from '@/api/client';
import { checkElement, fetchTypeStatus, type CheckResult, type GrmsType } from '@/api/grms';
import { useGrmsScope } from './scope';
import { queryKeys } from '@/api/queryKeys';
import { useToast } from '@/components/ToastProvider';

/**
 * Прогон элемента на живой комнате.
 *
 * Значение можно НЕ задавать — тогда выполняется только чтение: проверить
 * маппинг в занятом номере, ничего там не переключая. Это не удобство, а
 * условие работы на объекте, где живут гости.
 *
 * Исход показывается ровно тот, что вернул сервер, вместе с сырым ответом
 * железа: администратору нужен ответ на вопрос «а что реально сказало
 * оборудование», а не наша интерпретация.
 */
const OUTCOME_COLOR: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  confirmed: 'success',
  unconfirmed: 'warning',
  no_feedback_channel: 'warning',
  feedback_dead: 'warning',
  failed: 'error',
};

export function CheckTab({ type }: { type: GrmsType }) {
  const { t } = useTranslation();
  // База API — из области: CMS отеля или консоль платформы.
  const { transport } = useGrmsScope();
  const base = transport.base;
  const toast = useToast();

  const status = useQuery({
    queryKey: queryKeys.grmsStatus(base, type.code),
    queryFn: () => fetchTypeStatus(transport, type.code),
  });

  const [element, setElement] = useState('');
  const [room, setRoom] = useState(type.rooms[0] ?? '');
  const [capability, setCapability] = useState('');
  const [value, setValue] = useState('');
  const [result, setResult] = useState<CheckResult | null>(null);

  const runMutation = useMutation({
    mutationFn: (withValue: boolean) =>
      checkElement(transport, type.code, {
        element_slug: element,
        room_number: room,
        capability: capability || undefined,
        value: withValue && value !== '' ? Number(value) : null,
      }),
    onSuccess: setResult,
    onError: (error) =>
      toast.show(error instanceof ApiError ? error.detail : t('errors.generic'), 'error'),
  });

  // Пока черновик грузится, экран НЕ говорит «проверять нечего»: это утверждение
  // о конфигурации, а не о нашей загрузке, и одно на месте другого — ложь.
  const loading = status.isLoading;
  const elements = status.data?.elements.filter((e) => e.bindings.length > 0) ?? [];
  const capabilities = elements.find((e) => e.slug === element)?.bindings.map((b) => b.capability) ?? [];

  return (
    <Card variant="outlined" sx={{ borderColor: 'divider' }} data-testid="grms-check">
      <CardContent>
        <Typography variant="subtitle1">{t('roomControl.check.title')}</Typography>
        <Typography variant="caption" color="text.secondary">
          {t('roomControl.check.hint')}
        </Typography>
        <Divider sx={{ my: 1.5 }} />

        {loading ? (
          <Skeleton variant="rounded" height={56} />
        ) : elements.length === 0 ? (
          <Alert severity="info" data-testid="grms-check-nothing">
            {t('roomControl.check.nothingBound')}
          </Alert>
        ) : (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
            <TextField
              select
              size="small"
              sx={{ minWidth: 200 }}
              label={t('roomControl.builder.element')}
              value={element}
              onChange={(e) => {
                setElement(e.target.value);
                setCapability('');
              }}
              data-testid="grms-check-element"
            >
              {elements.map((item) => (
                <MenuItem key={item.slug} value={item.slug}>
                  {item.slug}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              sx={{ minWidth: 140 }}
              label={t('roomControl.builder.room')}
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              data-testid="grms-check-room"
            >
              {type.rooms.map((number) => (
                <MenuItem key={number} value={number}>
                  {number}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              sx={{ minWidth: 160 }}
              label={t('roomControl.builder.capability')}
              value={capability}
              onChange={(e) => setCapability(e.target.value)}
              disabled={!element}
              data-testid="grms-check-capability"
            >
              <MenuItem value="">{t('roomControl.check.defaultCapability')}</MenuItem>
              {capabilities.map((item) => (
                <MenuItem key={item} value={item}>
                  {item}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              type="number"
              sx={{ width: 120 }}
              label={t('roomControl.check.value')}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              data-testid="grms-check-value"
            />
            <Button
              variant="outlined"
              disabled={!element || !room || runMutation.isPending}
              onClick={() => runMutation.mutate(false)}
              data-testid="grms-check-read"
            >
              {t('roomControl.check.readOnly')}
            </Button>
            <Button
              variant="contained"
              disabled={!element || !room || value === '' || runMutation.isPending}
              onClick={() => runMutation.mutate(true)}
              data-testid="grms-check-run"
            >
              {t('roomControl.check.run')}
            </Button>
          </Stack>
        )}

        {result && (
          <Stack spacing={1.5} sx={{ mt: 2 }} data-testid="grms-check-result">
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Chip
                color={OUTCOME_COLOR[result.outcome] ?? 'default'}
                label={t(`roomControl.check.${result.outcome}`, { defaultValue: result.outcome })}
                data-testid={`grms-check-outcome-${result.outcome}`}
              />
              <Typography variant="body2" color="text.secondary">
                {result.device} · {result.room} · {result.capability}
              </Typography>
            </Stack>
            {result.note && <Typography variant="body2">{result.note}</Typography>}
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('roomControl.check.step')}</TableCell>
                  <TableCell>{t('roomControl.check.channel')}</TableCell>
                  <TableCell>{t('roomControl.check.value')}</TableCell>
                  <TableCell>{t('roomControl.check.answer')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {result.steps.map((step, index) => (
                  <TableRow key={`${step.step}-${index}`}>
                    <TableCell>{step.step}</TableCell>
                    <TableCell>{step.channel}</TableCell>
                    <TableCell>{step.value ?? '—'}</TableCell>
                    <TableCell>{step.error || (step.ok ? 'ok' : '—')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
