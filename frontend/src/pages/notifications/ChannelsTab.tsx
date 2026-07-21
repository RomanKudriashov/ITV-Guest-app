import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';

import { ApiError } from '@/api/client';
import {
  createNotificationChannel,
  deleteNotificationChannel,
  fetchNotificationChannels,
  fetchStaffUsers,
  testNotificationChannel,
  updateNotificationChannel,
} from '@/api/notifications';
import { queryKeys } from '@/api/queryKeys';
import type { NotificationChannel } from '@/api/notificationTypes';
import type { Bootstrap } from '@/api/types';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { useToast } from '@/components/ToastProvider';
import type { ContentLanguages } from '@/hooks/useBootstrap';
import {
  bindingOf,
  channelPayload,
  channelToDraft,
  emptyChannel,
  type ChannelDraft,
} from '@/notifications/channels';
import { pickTranslated } from '@/utils/translated';
import { ChannelDialog } from './ChannelDialog';

export interface ChannelsTabProps {
  bootstrap: Bootstrap | undefined;
  languages: ContentLanguages;
}

export function ChannelsTab({ bootstrap, languages }: ChannelsTabProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [draft, setDraft] = useState<ChannelDraft | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<NotificationChannel | null>(null);

  const channelsQuery = useQuery({
    queryKey: queryKeys.notificationChannels,
    queryFn: fetchNotificationChannels,
  });

  const staffQuery = useQuery({
    queryKey: queryKeys.staffUsers,
    queryFn: fetchStaffUsers,
    staleTime: 5 * 60 * 1000,
  });

  const channels = channelsQuery.data ?? [];
  const editing = draft?.id ? channels.find((channel) => channel.id === draft.id) : undefined;

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.notificationChannels });

  const applyError = (error: unknown) => {
    if (error instanceof ApiError && error.isValidation) {
      // `422 channel_config_invalid` names the offending config key in `field`.
      const field = error.field;
      if (field) {
        const target = field.startsWith('config.') || !error.payload.config ? field : `config.${field}`;
        setServerErrors({ [target]: error.detail });
        return;
      }
    }
    toast.show(error instanceof ApiError ? error.detail : t('errors.generic'), 'error');
  };

  const saveMutation = useMutation({
    mutationFn: (value: ChannelDraft) =>
      value.id
        ? updateNotificationChannel(value.id, channelPayload(value))
        : createNotificationChannel(channelPayload(value)),
    onSuccess: (saved) => {
      toast.show(t('notifications.channels.saved'), 'success');
      setServerErrors({});
      setDraft(null);
      queryClient.setQueryData<NotificationChannel[]>(queryKeys.notificationChannels, (current) => {
        if (!current) return current;
        const exists = current.some((channel) => channel.id === saved.id);
        return exists
          ? current.map((channel) => (channel.id === saved.id ? saved : channel))
          : [...current, saved];
      });
      void invalidate();
    },
    onError: applyError,
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => testNotificationChannel(id),
    onSuccess: (result) => {
      const ok = result?.ok !== false;
      setTestResult({
        ok,
        message: ok
          ? result?.detail || t('notifications.channels.testOk')
          : result?.error || result?.detail || t('notifications.channels.testFailed'),
      });
    },
    onError: (error) =>
      setTestResult({
        ok: false,
        message: error instanceof ApiError ? error.detail : t('notifications.channels.testFailed'),
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteNotificationChannel(id),
    onSuccess: () => {
      toast.show(t('notifications.channels.deleted'), 'success');
      setPendingDelete(null);
      void invalidate();
    },
    onError: (error) =>
      toast.show(error instanceof ApiError ? error.detail : t('errors.generic'), 'error'),
  });

  const openNew = () => {
    setServerErrors({});
    setTestResult(null);
    setDraft(emptyChannel());
  };

  const openExisting = (channel: NotificationChannel) => {
    setServerErrors({});
    setTestResult(null);
    setDraft(channelToDraft(channel));
  };

  const bindingLabel = (channel: NotificationChannel) => {
    const binding = bindingOf(channel);
    if (binding === 'point') {
      const point = bootstrap?.execution_points.find(
        (entry) => entry.id === channel.execution_point_id,
      );
      return point
        ? pickTranslated(point.title, languages.displayLanguage, languages.defaultCode) || point.code
        : t('notifications.channels.bindings.point');
    }
    if (binding === 'user') {
      const user = staffQuery.data?.find((entry) => entry.id === channel.user_id);
      return user?.full_name || user?.email || t('notifications.channels.bindings.user');
    }
    return t('notifications.channels.bindings.hotel');
  };

  return (
    <Card variant="outlined" sx={{ borderColor: 'divider' }}>
      <CardContent sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Stack>
            <Typography variant="h6">{t('notifications.channels.title')}</Typography>
            <Typography variant="caption" color="text.secondary">
              {t('notifications.channels.hint')}
            </Typography>
          </Stack>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={openNew}
            data-testid="cms-channel-add"
          >
            {t('notifications.channels.add')}
          </Button>
        </Stack>
        <Divider sx={{ mb: 1 }} />

        {channelsQuery.isLoading ? (
          <Stack spacing={1}>
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} variant="rounded" height={48} />
            ))}
          </Stack>
        ) : channelsQuery.isError ? (
          <Alert severity="error">{t('notifications.channels.loadError')}</Alert>
        ) : channels.length === 0 ? (
          <EmptyState
            testId="cms-channels-empty"
            title={t('notifications.channels.empty')}
            description={t('notifications.channels.emptyHint')}
            action={
              <Button variant="contained" size="small" onClick={openNew}>
                {t('notifications.channels.add')}
              </Button>
            }
          />
        ) : (
          <Box data-testid="cms-channels-list">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('notifications.channels.type')}</TableCell>
                  <TableCell>{t('notifications.channels.name')}</TableCell>
                  <TableCell>{t('notifications.channels.binding')}</TableCell>
                  <TableCell>{t('notifications.channels.active')}</TableCell>
                  <TableCell align="right">{t('common.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {channels.map((channel) => (
                  <TableRow key={channel.id} hover data-testid={`cms-channel-${channel.id}`}>
                    <TableCell>
                      <Chip size="small" label={t(`notifications.channels.types.${channel.type}`)} />
                    </TableCell>
                    <TableCell>{channel.title}</TableCell>
                    <TableCell>{bindingLabel(channel)}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        variant={channel.is_active ? 'filled' : 'outlined'}
                        color={channel.is_active ? 'success' : 'default'}
                        label={
                          channel.is_active
                            ? t('notifications.channels.on')
                            : t('notifications.channels.off')
                        }
                      />
                    </TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        onClick={() => openExisting(channel)}
                        aria-label={t('common.edit')}
                        data-testid={`cms-channel-edit-${channel.id}`}
                      >
                        <EditOutlinedIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => setPendingDelete(channel)}
                        aria-label={t('common.delete')}
                        data-testid={`cms-channel-delete-${channel.id}`}
                      >
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </CardContent>

      {draft ? (
        <ChannelDialog
          open
          draft={draft}
          onChange={(next) => setDraft(next)}
          onClose={() => setDraft(null)}
          onSave={() => saveMutation.mutate(draft)}
          onTest={() => draft.id && testMutation.mutate(draft.id)}
          saving={saveMutation.isPending}
          testing={testMutation.isPending}
          testResult={testResult}
          serverErrors={serverErrors}
          configPublic={editing?.config_public}
          executionPoints={bootstrap?.execution_points ?? []}
          staffUsers={staffQuery.data ?? []}
          languages={languages.codes}
          languageLabels={languages.labels}
          defaultLanguage={languages.defaultCode}
          displayLanguage={languages.displayLanguage}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        testId="cms-channel-delete-dialog"
        destructive
        busy={deleteMutation.isPending}
        title={t('notifications.channels.deleteTitle')}
        description={t('notifications.channels.deleteBody', { name: pendingDelete?.title ?? '' })}
        confirmLabel={t('common.delete')}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
      />
    </Card>
  );
}
