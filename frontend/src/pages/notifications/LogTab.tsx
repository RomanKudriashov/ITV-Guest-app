import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import SubdirectoryArrowRightIcon from '@mui/icons-material/SubdirectoryArrowRight';

import { fetchNotificationLog } from '@/api/notifications';
import { queryKeys } from '@/api/queryKeys';
import type { NotificationChannel, NotificationLogEntry } from '@/api/notificationTypes';
import { EmptyState } from '@/components/EmptyState';
import {
  LOG_STATUSES,
  flattenLog,
  groupLog,
  logStatusSlot,
  logStatusSpec,
  type LogStatus,
} from '@/notifications/log';

/** Kept short so «ступень сработала → ушло в два канала» stays legible live. */
const REFETCH_MS = 10_000;
const LIMIT = 100;

export interface LogTabProps {
  channels: NotificationChannel[];
}

export function LogTab({ channels }: LogTabProps) {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<LogStatus | ''>('');
  const [orderId, setOrderId] = useState('');

  const logQuery = useQuery({
    queryKey: queryKeys.notificationLog(status, orderId, LIMIT),
    queryFn: () =>
      fetchNotificationLog({
        status: status || undefined,
        order_id: orderId.trim() || undefined,
        limit: LIMIT,
      }),
    // The journal is a live surface: it refreshes while the tab is open and
    // stops the moment it unmounts.
    refetchInterval: REFETCH_MS,
    refetchIntervalInBackground: false,
  });

  const rows = useMemo(() => flattenLog(groupLog(logQuery.data ?? [])), [logQuery.data]);

  const channelTitle = (entry: NotificationLogEntry) => {
    if (!entry.channel_id) return '—';
    const channel = channels.find((item) => item.id === entry.channel_id);
    return channel?.title ?? entry.channel_type ?? entry.channel_id;
  };

  const timeLabel = (entry: NotificationLogEntry) => {
    const raw = entry.sent_at || entry.scheduled_for;
    if (!raw) return '—';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    return new Intl.DateTimeFormat(i18n.resolvedLanguage ?? 'ru', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(date);
  };

  return (
    <Card variant="outlined" sx={{ borderColor: 'divider' }}>
      <CardContent sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Stack>
            <Typography variant="h6">{t('notifications.log.title')}</Typography>
            <Typography variant="caption" color="text.secondary">
              {t('notifications.log.hint')}
            </Typography>
          </Stack>
          <Stack direction="row" spacing={2}>
            <TextField
              size="small"
              label={t('notifications.log.order')}
              value={orderId}
              onChange={(event) => setOrderId(event.target.value)}
              sx={{ width: 220 }}
              inputProps={{ 'data-testid': 'cms-log-order-filter' }}
            />
            <TextField
              select
              size="small"
              label={t('notifications.log.status')}
              value={status}
              onChange={(event) => setStatus(event.target.value as LogStatus | '')}
              sx={{ width: 200 }}
              SelectProps={{ native: true }}
              InputLabelProps={{ shrink: true }}
              inputProps={{ 'data-testid': 'cms-log-status-filter' }}
            >
              <option value="">{t('notifications.log.allStatuses')}</option>
              {LOG_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(`notifications.log.statuses.${value}`)}
                </option>
              ))}
            </TextField>
          </Stack>
        </Stack>
        <Divider sx={{ mb: 1 }} />

        {logQuery.isLoading ? (
          <Stack spacing={1}>
            {[0, 1, 2, 3].map((key) => (
              <Skeleton key={key} variant="rounded" height={36} />
            ))}
          </Stack>
        ) : logQuery.isError ? (
          <Alert severity="error">{t('notifications.log.loadError')}</Alert>
        ) : rows.length === 0 ? (
          <EmptyState
            testId="cms-log-empty"
            title={t('notifications.log.empty')}
            description={t('notifications.log.emptyHint')}
          />
        ) : (
          <Box data-testid="cms-notification-log" sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('notifications.log.time')}</TableCell>
                  <TableCell>{t('notifications.log.order')}</TableCell>
                  <TableCell>{t('notifications.log.step')}</TableCell>
                  <TableCell>{t('notifications.log.target')}</TableCell>
                  <TableCell>{t('notifications.log.channel')}</TableCell>
                  <TableCell>{t('notifications.log.status')}</TableCell>
                  <TableCell>{t('notifications.log.error')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map(({ entry, depth }, index) => {
                  const spec = logStatusSpec(entry.status);
                  const slot = logStatusSlot(entry.status);
                  return (
                    <TableRow
                      key={entry.id}
                      hover
                      data-testid={`cms-log-row-${index}`}
                      sx={depth > 0 ? { bgcolor: 'brand.surfaceMuted' } : undefined}
                    >
                      <TableCell sx={{ whiteSpace: 'nowrap', pl: depth > 0 ? 4 : 2 }}>
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          {depth > 0 ? (
                            <SubdirectoryArrowRightIcon fontSize="small" color="disabled" />
                          ) : null}
                          <span>{timeLabel(entry)}</span>
                        </Stack>
                      </TableCell>
                      <TableCell>№{entry.order_number}</TableCell>
                      <TableCell>
                        {depth === 0
                          ? t('notifications.log.stepN', { n: entry.step_index + 1 })
                          : t('notifications.log.delivery')}
                      </TableCell>
                      <TableCell>
                        {entry.target_kind
                          ? t(`notifications.escalation.targets.${entry.target_kind}`)
                          : '—'}
                      </TableCell>
                      <TableCell>{channelTitle(entry)}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          variant={spec.variant}
                          label={t(`notifications.log.statuses.${entry.status}`)}
                          sx={{
                            // Colour comes from the theme slot the status token
                            // resolves to — never from a literal.
                            bgcolor: spec.variant === 'filled' ? `${slot}.main` : undefined,
                            color: spec.variant === 'filled' ? `${slot}.contrastText` : `${slot}.main`,
                            borderColor: `${slot}.main`,
                          }}
                        />
                      </TableCell>
                      <TableCell sx={{ color: 'error.main', maxWidth: 260 }}>
                        {entry.error || ''}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
