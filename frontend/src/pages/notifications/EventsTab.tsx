import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { ApiError } from '@/api/client';
import { fetchEventSettings, previewEvent, saveEventSetting } from '@/api/notifications';
import type {
  EventPreview,
  EventPreviewSource,
  EventSettingItem,
  NotificationChannel,
} from '@/api/notificationTypes';
import { queryKeys } from '@/api/queryKeys';
import { useAuth } from '@/auth/AuthProvider';
import { QueryState } from '@/components/QueryState';
import { useToast } from '@/components/ToastProvider';
import type { ContentLanguages } from '@/hooks/useBootstrap';
import { CHANNEL_TYPES, type ChannelType } from '@/notifications/channels';
import {
  AUDIENCES,
  defaultDraft,
  draftProblems,
  eventPayload,
  eventToDraft,
  isDirty,
  type EventDraft,
} from '@/notifications/events';

export interface EventsTabProps {
  languages: ContentLanguages;
  channels: NotificationChannel[];
}

/**
 * События, которые система умеет сообщать, и решение отеля по каждому:
 * слать ли, кому, чем и каким текстом. Рядом — «вот так придёт» на последнем
 * настоящем случае из данных отеля.
 */
export function EventsTab({ languages, channels }: EventsTabProps) {
  const { t } = useTranslation();
  // Настраивает администратор отеля — сервер скажет то же самое, но экран не
  // должен предлагать то, что отвергнут.
  const canEdit = Boolean(useAuth().user?.is_hotel_admin);

  const settingsQuery = useQuery({
    queryKey: queryKeys.notificationEventSettings,
    queryFn: fetchEventSettings,
  });

  return (
    <Stack spacing={2} data-testid="cms-notification-events">
      <Stack spacing={0.5}>
        <Typography variant="h6">{t('notifications.events.title')}</Typography>
        <Typography variant="body2" color="text.secondary">
          {t('notifications.events.hint')}
        </Typography>
      </Stack>
      {!canEdit ? (
        <Alert severity="info" data-testid="events-read-only">
          {t('notifications.events.readOnly')}
        </Alert>
      ) : null}
      <QueryState query={settingsQuery} what={t('state.what.notificationEvents')}>
        {(items) => (
          <Stack spacing={1.5}>
            {items.map((item) => (
              <EventCard
                // Сохранённая настройка — новый черновик.
                key={`${item.code}:${JSON.stringify(item.setting)}`}
                item={item}
                channels={channels}
                languages={languages}
                canEdit={canEdit}
              />
            ))}
          </Stack>
        )}
      </QueryState>
    </Stack>
  );
}

interface EventCardProps {
  item: EventSettingItem;
  channels: NotificationChannel[];
  languages: ContentLanguages;
  canEdit: boolean;
}

function EventCard({ item, channels, languages, canEdit }: EventCardProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState<EventDraft>(() => eventToDraft(item));
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<{ field?: string; detail: string } | null>(null);

  // Языки текста — те, что есть и у отеля, и у справочника.
  const textLanguages = useMemo(() => {
    const known = languages.codes.filter((code) => item.defaults[code]);
    return known.length ? known : Object.keys(item.defaults);
  }, [languages.codes, item.defaults]);
  const [language, setLanguage] = useState(
    textLanguages.includes(languages.defaultCode) ? languages.defaultCode : textLanguages[0],
  );

  const problems = draftProblems(draft, item);
  const dirty = isDirty(draft, item);
  const code = item.code;

  const saveMutation = useMutation({
    mutationFn: () => saveEventSetting(code, eventPayload(draft, item)),
    onSuccess: (setting) => {
      toast.show(t('notifications.events.saved'), 'success');
      setServerError(null);
      queryClient.setQueryData<EventSettingItem[]>(
        queryKeys.notificationEventSettings,
        (current) =>
          current?.map((entry) => (entry.code === code ? { ...entry, setting } : entry)) ?? current,
      );
    },
    onError: (error) => {
      if (error instanceof ApiError && error.isValidation) {
        setServerError({ field: error.field, detail: error.detail });
        return;
      }
      toast.show(error instanceof ApiError ? error.detail : t('errors.generic'), 'error');
    },
  });

  const update = (patch: Partial<EventDraft>) => {
    setServerError(null);
    setDraft((current) => ({ ...current, ...patch }));
  };

  const updateText = (field: 'subject' | 'body', value: string) => {
    setServerError(null);
    setDraft((current) => ({
      ...current,
      templates: {
        ...current.templates,
        [language]: {
          subject: current.templates[language]?.subject ?? '',
          body: current.templates[language]?.body ?? '',
          [field]: value,
        },
      },
    }));
  };

  const fieldError = (key: string): string | undefined => {
    if (serverError?.field === key) return serverError.detail;
    const problem = problems[key];
    if (!problem) return undefined;
    if (problem === 'incomplete') return t('notifications.events.errors.incomplete');
    if (problem === 'channel_required') return t('notifications.events.errors.channelRequired');
    if (problem.startsWith('unknown:')) {
      return t('notifications.events.errors.unknownPlaceholder', {
        names: problem
          .slice('unknown:'.length)
          .split(',')
          .map((name) => `{{${name}}}`)
          .join(', '),
      });
    }
    return undefined;
  };

  const channelTitle = (id: string) => channels.find((channel) => channel.id === id)?.title ?? '';
  const template = draft.templates[language] ?? { subject: '', body: '' };
  const fallback = item.defaults[language] ?? { subject: '', body: '' };

  return (
    <Card variant="outlined" data-testid={`event-card-${code}`} sx={{ minWidth: 0 }}>
      <CardContent>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          alignItems={{ sm: 'center' }}
          justifyContent="space-between"
        >
          <Stack spacing={0.5} sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {item.title}
            </Typography>
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
              <Chip
                size="small"
                color={draft.enabled ? 'success' : 'default'}
                label={t(draft.enabled ? 'notifications.events.on' : 'notifications.events.off')}
                data-testid={`event-state-${code}`}
              />
              {item.enabled_by_default ? (
                <Chip size="small" variant="outlined" label={t('notifications.events.actionable')} />
              ) : null}
              <Chip
                size="small"
                variant="outlined"
                label={
                  item.audience_from_rules
                    ? t('notifications.events.audienceFromRules')
                    : draft.audience === 'channel'
                      ? t('notifications.events.toChannel', {
                          name: channelTitle(draft.channelId) || '—',
                        })
                      : t(`notifications.events.audiences.${draft.audience}`)
                }
              />
              {!item.setting.customized ? (
                <Chip size="small" variant="outlined" label={t('notifications.events.byDefault')} />
              ) : null}
            </Stack>
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: 'none' }}>
            <FormControlLabel
              control={
                <Switch
                  checked={draft.enabled}
                  onChange={(event) => update({ enabled: event.target.checked })}
                  disabled={!canEdit}
                  inputProps={{ 'aria-label': t('notifications.events.enabled') }}
                  data-testid={`event-toggle-${code}`}
                />
              }
              label={t('notifications.events.enabled')}
            />
            <Button
              size="small"
              onClick={() => setOpen((value) => !value)}
              data-testid={`event-expand-${code}`}
            >
              {open ? t('notifications.events.collapse') : t('notifications.events.configure')}
            </Button>
          </Stack>
        </Stack>

        {dirty ? (
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            alignItems={{ sm: 'center' }}
            sx={{ mt: 1.5 }}
          >
            <Typography variant="body2" color="warning.main" sx={{ flex: 1 }}>
              {t('notifications.events.unsaved')}
            </Typography>
            <Button size="small" onClick={() => setDraft(eventToDraft(item))} disabled={!canEdit}>
              {t('notifications.events.discard')}
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={() => saveMutation.mutate()}
              disabled={!canEdit || saveMutation.isPending || Object.keys(problems).length > 0}
              data-testid={`event-save-${code}`}
            >
              {t('notifications.events.save')}
            </Button>
          </Stack>
        ) : null}
        {canEdit && item.setting.customized && !dirty ? (
          <Button
            size="small"
            sx={{ mt: 1 }}
            onClick={() => setDraft(defaultDraft(item))}
            data-testid={`event-reset-${code}`}
          >
            {t('notifications.events.resetDefaults')}
          </Button>
        ) : null}
        {serverError && !serverError.field?.startsWith('templates') ? (
          <Alert severity="error" sx={{ mt: 1.5 }} data-testid={`event-error-${code}`}>
            {serverError.detail}
          </Alert>
        ) : null}

        <Collapse in={open} unmountOnExit>
          <Divider sx={{ my: 2 }} />
          <Box
            sx={{
              display: 'grid',
              gap: 2,
              // minmax(0, …): иначе вкладки языков и длинные подстановки
              // распирают колонку шире экрана телефона.
              gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) minmax(0, 1fr)' },
            }}
          >
            <Stack spacing={2}>
              {item.audience_from_rules ? (
                <Alert severity="info">{t('notifications.events.rulesHint')}</Alert>
              ) : (
                <>
                  <TextField
                    select
                    size="small"
                    label={t('notifications.events.audience')}
                    value={draft.audience}
                    onChange={(event) =>
                      update({ audience: event.target.value as EventDraft['audience'] })
                    }
                    disabled={!canEdit}
                    helperText={t(`notifications.events.audienceHint.${draft.audience}`)}
                    inputProps={{ 'data-testid': `event-audience-${code}` }}
                  >
                    {AUDIENCES.map((audience) => (
                      <MenuItem key={audience} value={audience}>
                        {t(`notifications.events.audiences.${audience}`)}
                        {audience === item.audience ? ` · ${t('notifications.events.registry')}` : ''}
                      </MenuItem>
                    ))}
                  </TextField>
                  {draft.audience === 'channel' ? (
                    <TextField
                      select
                      size="small"
                      label={t('notifications.events.channel')}
                      value={draft.channelId}
                      onChange={(event) => update({ channelId: event.target.value })}
                      disabled={!canEdit}
                      error={Boolean(fieldError('channel_id'))}
                      helperText={fieldError('channel_id')}
                      inputProps={{ 'data-testid': `event-channel-${code}` }}
                    >
                      {channels
                        .filter((channel) => channel.is_active)
                        .map((channel) => (
                          <MenuItem key={channel.id} value={channel.id}>
                            {channel.title}
                          </MenuItem>
                        ))}
                    </TextField>
                  ) : null}
                  <Stack spacing={0.75}>
                    <Typography variant="body2" color="text.secondary">
                      {t('notifications.events.channelTypes')}
                    </Typography>
                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                      {CHANNEL_TYPES.map((type: ChannelType) => {
                        const selected = draft.channelTypes.includes(type);
                        return (
                          <Chip
                            key={type}
                            label={t(`notifications.channels.types.${type}`)}
                            color={selected ? 'primary' : 'default'}
                            variant={selected ? 'filled' : 'outlined'}
                            disabled={!canEdit}
                            onClick={() =>
                              update({
                                channelTypes: selected
                                  ? draft.channelTypes.filter((entry) => entry !== type)
                                  : [...draft.channelTypes, type],
                              })
                            }
                            data-testid={`event-type-${code}-${type}`}
                          />
                        );
                      })}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {draft.channelTypes.length
                        ? t('notifications.events.channelTypesSome')
                        : t('notifications.events.channelTypesAny')}
                    </Typography>
                  </Stack>
                </>
              )}

              <Stack spacing={1}>
                <Typography variant="body2" color="text.secondary">
                  {t('notifications.events.text')}
                </Typography>
                {textLanguages.length > 1 ? (
                  <Tabs
                    value={language}
                    onChange={(_event, value: string) => setLanguage(value)}
                    variant="scrollable"
                  >
                    {textLanguages.map((code_) => (
                      <Tab
                        key={code_}
                        value={code_}
                        label={languages.labels[code_] ?? code_.toUpperCase()}
                        data-testid={`event-language-${code}-${code_}`}
                      />
                    ))}
                  </Tabs>
                ) : null}
                <TextField
                  size="small"
                  label={t('notifications.events.subject')}
                  value={template.subject}
                  placeholder={fallback.subject}
                  // Подпись всегда сверху — иначе текст по умолчанию (подсказка
                  // поля) виден только в фокусе, а экран обещает «виден серым».
                  InputLabelProps={{ shrink: true }}
                  onChange={(event) => updateText('subject', event.target.value)}
                  disabled={!canEdit}
                  error={Boolean(fieldError(`templates.${language}.subject`))}
                  helperText={fieldError(`templates.${language}.subject`)}
                  inputProps={{ 'data-testid': `event-subject-${code}-${language}` }}
                />
                <TextField
                  size="small"
                  multiline
                  minRows={3}
                  label={t('notifications.events.body')}
                  value={template.body}
                  placeholder={fallback.body}
                  InputLabelProps={{ shrink: true }}
                  onChange={(event) => updateText('body', event.target.value)}
                  disabled={!canEdit}
                  error={Boolean(fieldError(`templates.${language}.body`))}
                  helperText={
                    fieldError(`templates.${language}.body`) ??
                    t('notifications.events.textHint')
                  }
                  inputProps={{ 'data-testid': `event-body-${code}-${language}` }}
                />
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                  {item.placeholders.map((name) => (
                    <Chip
                      key={name}
                      size="small"
                      variant="outlined"
                      label={`{{${name}}}`}
                      disabled={!canEdit}
                      onClick={() => updateText('body', `${template.body}{{${name}}}`)}
                      title={t(`notifications.events.placeholders.${name}`, { defaultValue: name })}
                    />
                  ))}
                </Stack>
              </Stack>
            </Stack>

            {canEdit ? (
              <PreviewPanel
                item={item}
                draft={draft}
                language={language}
                blocked={Object.keys(problems).length > 0}
              />
            ) : null}
          </Box>
        </Collapse>
      </CardContent>
    </Card>
  );
}

/* ── Preview ───────────────────────────────────────────────────────────── */

function useDebounced<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

function PreviewPanel({
  item,
  draft,
  language,
  blocked,
}: {
  item: EventSettingItem;
  draft: EventDraft;
  language: string;
  blocked: boolean;
}) {
  const { t } = useTranslation();
  const payloadKey = useDebounced(JSON.stringify({ ...eventPayload(draft, item), language }), 400);

  const previewQuery = useQuery({
    queryKey: ['cms', 'notification-events', 'preview', item.code, payloadKey] as const,
    queryFn: () => previewEvent(item.code, JSON.parse(payloadKey)),
    enabled: !blocked,
    placeholderData: keepPreviousData,
    retry: false,
  });

  return (
    <Box
      data-testid={`event-preview-${item.code}`}
      sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5, minWidth: 0 }}
    >
      <Typography variant="overline" color="text.secondary">
        {t('notifications.events.preview.title')}
      </Typography>
      {previewQuery.isFetching ? <LinearProgress sx={{ my: 0.5 }} /> : null}
      {blocked ? (
        <Typography variant="body2" color="text.secondary">
          {t('notifications.events.preview.blocked')}
        </Typography>
      ) : previewQuery.isError ? (
        <Alert severity="error" data-testid="event-preview-error">
          {previewQuery.error instanceof ApiError
            ? previewQuery.error.detail
            : t('notifications.events.preview.failed')}
        </Alert>
      ) : previewQuery.data ? (
        <PreviewBody preview={previewQuery.data} />
      ) : null}
    </Box>
  );
}

function PreviewBody({ preview }: { preview: EventPreview }) {
  const { t } = useTranslation();

  if (!preview.example || !preview.message) {
    // Настоящего случая ещё не было — и выдумывать его мы не будем: придуманный
    // заказ на экране неотличим от настоящего.
    return (
      <Alert severity="info" data-testid="event-preview-empty">
        {t('notifications.events.preview.noExample')}
      </Alert>
    );
  }

  const recipients = preview.recipients ?? [];
  return (
    <Stack spacing={1.25}>
      <Typography variant="body2" color="text.secondary" data-testid="event-preview-source">
        {sourceLabel(preview.example.source, t)}
      </Typography>
      {!preview.enabled ? (
        <Alert severity="warning" data-testid="event-preview-disabled">
          {t('notifications.events.preview.disabled')}
        </Alert>
      ) : null}
      <MessageBox
        subject={preview.message.subject}
        body={preview.message.body}
        testId="event-preview-message"
      />
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {t('notifications.events.preview.recipients', { count: recipients.length })}
      </Typography>
      {recipients.length === 0 ? (
        <Alert severity="warning" data-testid="event-preview-nobody">
          {t('notifications.events.preview.nobody')}
        </Alert>
      ) : (
        <Stack spacing={0.75}>
          {recipients.map((recipient, index) => (
            <Box
              key={`${recipient.channel_id}-${index}`}
              data-testid="event-preview-recipient"
              sx={{ borderLeft: 3, borderColor: 'divider', pl: 1 }}
            >
              <Typography variant="body2">
                {recipient.step
                  ? `${t('notifications.events.preview.step', {
                      minutes: recipient.step.delay_minutes,
                    })} · `
                  : ''}
                {recipient.recipient ?? recipient.channel_title}
                {' · '}
                {t(`notifications.channels.types.${recipient.channel_type}`)}
                {' · '}
                {recipient.language.toUpperCase()}
              </Typography>
              {recipient.language !== preview.message?.language ||
              recipient.subject !== preview.message?.subject ||
              recipient.body !== preview.message?.body ? (
                <MessageBox subject={recipient.subject} body={recipient.body} dense />
              ) : null}
            </Box>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function MessageBox({
  subject,
  body,
  dense = false,
  testId,
}: {
  subject: string;
  body: string;
  dense?: boolean;
  testId?: string;
}) {
  return (
    <Box
      data-testid={testId}
      sx={{ bgcolor: 'action.hover', borderRadius: 1, p: dense ? 0.75 : 1.25, mt: dense ? 0.5 : 0 }}
    >
      <Typography
        variant={dense ? 'caption' : 'body2'}
        sx={{ fontWeight: 600, display: 'block' }}
        data-testid={testId ? `${testId}-subject` : undefined}
      >
        {subject}
      </Typography>
      <Typography
        variant={dense ? 'caption' : 'body2'}
        sx={{ whiteSpace: 'pre-wrap', display: 'block', overflowWrap: 'anywhere' }}
        data-testid={testId ? `${testId}-body` : undefined}
      >
        {body}
      </Typography>
    </Box>
  );
}

function sourceLabel(
  source: EventPreviewSource,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  const at = source.at
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(
        new Date(source.at),
      )
    : '';
  const what = t(`notifications.events.preview.source.${source.kind}`, {
    number: source.number ?? '',
    room: source.room || '—',
    rating: source.rating ?? '',
    version: source.version ?? '—',
    channel: source.channel ?? '',
  });
  return [t('notifications.events.preview.basedOn', { what }), at, source.point]
    .filter(Boolean)
    .join(' · ');
}
