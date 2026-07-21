import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import SendIcon from '@mui/icons-material/Send';

import type { ExecutionPoint } from '@/api/types';
import type { NotificationStaffUser } from '@/api/notificationTypes';
import {
  CHANNEL_BINDINGS,
  CHANNEL_TYPES,
  TEMPLATE_PLACEHOLDERS,
  channelSpec,
  maskedSecret,
  validateChannel,
  type ChannelBinding,
  type ChannelDraft,
  type ChannelType,
} from '@/notifications/channels';
import { pickTranslated } from '@/utils/translated';

export interface ChannelDialogProps {
  open: boolean;
  draft: ChannelDraft;
  onChange: (draft: ChannelDraft) => void;
  onClose: () => void;
  onSave: () => void;
  onTest: () => void;
  saving: boolean;
  testing: boolean;
  /** Result of the last probe, or `null` while none was made. */
  testResult: { ok: boolean; message: string } | null;
  /** `title` / `execution_point_id` / `user_id` / `config.<name>` → message. */
  serverErrors: Record<string, string>;
  /** Masked secrets as the server reports them, for the placeholder hint. */
  configPublic: Record<string, unknown> | null | undefined;
  executionPoints: ExecutionPoint[];
  staffUsers: NotificationStaffUser[];
  languages: string[];
  languageLabels: Record<string, string>;
  defaultLanguage: string;
  displayLanguage: string;
}

/**
 * Channel editor. Which boxes appear is decided by the channel-type table
 * (`src/notifications/channels.ts`), so this component stays a layout and never
 * grows a chain of `if (type === 'telegram')`.
 */
export function ChannelDialog({
  open,
  draft,
  onChange,
  onClose,
  onSave,
  onTest,
  saving,
  testing,
  testResult,
  serverErrors,
  configPublic,
  executionPoints,
  staffUsers,
  languages,
  languageLabels,
  defaultLanguage,
  displayLanguage,
}: ChannelDialogProps) {
  const { t } = useTranslation();
  const [templateLanguage, setTemplateLanguage] = useState(defaultLanguage);
  const [touched, setTouched] = useState(false);

  const spec = channelSpec(draft.type);

  const errors = useMemo(() => {
    const local: Record<string, string> = {};
    if (touched) {
      for (const error of validateChannel(draft)) {
        local[error.field] = t(error.messageKey);
      }
    }
    return { ...local, ...serverErrors };
  }, [draft, serverErrors, t, touched]);

  const activeLanguage = languages.includes(templateLanguage) ? templateLanguage : defaultLanguage;
  const template = draft.templates[activeLanguage] ?? { subject: '', body: '' };

  const patch = (changes: Partial<ChannelDraft>) => onChange({ ...draft, ...changes });

  const patchConfig = (name: string, value: string) =>
    patch({ config: { ...draft.config, [name]: value } });

  const patchTemplate = (changes: Partial<{ subject: string; body: string }>) =>
    patch({
      templates: {
        ...draft.templates,
        [activeLanguage]: { ...template, ...changes },
      },
    });

  const handleSave = () => {
    setTouched(true);
    if (validateChannel(draft).length > 0) return;
    onSave();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {draft.id ? t('notifications.channels.editTitle') : t('notifications.channels.newTitle')}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <Stack direction="row" spacing={2} alignItems="flex-start" flexWrap="wrap" useFlexGap>
            <TextField
              select
              size="small"
              label={t('notifications.channels.type')}
              value={draft.type}
              onChange={(event) => patch({ type: event.target.value as ChannelType, config: {} })}
              sx={{ minWidth: 200 }}
              SelectProps={{ native: true }}
              InputLabelProps={{ shrink: true }}
              inputProps={{ 'data-testid': 'cms-channel-type' }}
            >
              {CHANNEL_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`notifications.channels.types.${type}`)}
                </option>
              ))}
            </TextField>

            <TextField
              size="small"
              label={t('notifications.channels.name')}
              value={draft.title}
              onChange={(event) => patch({ title: event.target.value })}
              error={Boolean(errors.title)}
              helperText={errors.title}
              sx={{ minWidth: 260, flexGrow: 1 }}
              inputProps={{ 'data-testid': 'cms-channel-title', maxLength: 120 }}
            />

            <FormControlLabel
              control={
                <Switch
                  checked={draft.is_active}
                  onChange={(event) => patch({ is_active: event.target.checked })}
                  inputProps={
                    { 'data-testid': 'cms-channel-active' } as unknown as Record<string, string>
                  }
                />
              }
              label={t('notifications.channels.active')}
            />
          </Stack>

          <Typography variant="caption" color="text.secondary">
            {t(`notifications.channels.typeHint.${draft.type}`)}
          </Typography>

          <Divider />

          {/* ── Binding ─────────────────────────────────────────────── */}
          <Stack direction="row" spacing={2} alignItems="flex-start" flexWrap="wrap" useFlexGap>
            <TextField
              select
              size="small"
              label={t('notifications.channels.binding')}
              value={draft.binding}
              onChange={(event) =>
                patch({
                  binding: event.target.value as ChannelBinding,
                  execution_point_id: null,
                  user_id: null,
                })
              }
              sx={{ minWidth: 200 }}
              SelectProps={{ native: true }}
              InputLabelProps={{ shrink: true }}
              inputProps={{ 'data-testid': 'cms-channel-binding' }}
            >
              {CHANNEL_BINDINGS.map((binding) => (
                <option key={binding} value={binding}>
                  {t(`notifications.channels.bindings.${binding}`)}
                </option>
              ))}
            </TextField>

            {draft.binding === 'point' ? (
              <TextField
                select
                size="small"
                label={t('notifications.channels.point')}
                value={draft.execution_point_id ?? ''}
                onChange={(event) => patch({ execution_point_id: event.target.value || null })}
                error={Boolean(errors.execution_point_id)}
                helperText={errors.execution_point_id}
                sx={{ minWidth: 240 }}
                SelectProps={{ native: true }}
                InputLabelProps={{ shrink: true }}
                inputProps={{ 'data-testid': 'cms-channel-point' }}
              >
                <option value="">{t('common.none')}</option>
                {executionPoints.map((point) => (
                  <option key={point.id} value={point.id}>
                    {pickTranslated(point.title, displayLanguage, defaultLanguage) || point.code}
                  </option>
                ))}
              </TextField>
            ) : null}

            {draft.binding === 'user' ? (
              <TextField
                select
                size="small"
                label={t('notifications.channels.user')}
                value={draft.user_id ?? ''}
                onChange={(event) => patch({ user_id: event.target.value || null })}
                error={Boolean(errors.user_id)}
                helperText={
                  errors.user_id ??
                  (staffUsers.length === 0 ? t('notifications.channels.noStaff') : undefined)
                }
                disabled={staffUsers.length === 0}
                sx={{ minWidth: 240 }}
                SelectProps={{ native: true }}
                InputLabelProps={{ shrink: true }}
                inputProps={{ 'data-testid': 'cms-channel-user' }}
              >
                <option value="">{t('common.none')}</option>
                {staffUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.full_name || user.email}
                  </option>
                ))}
              </TextField>
            ) : null}
          </Stack>

          {/* ── Config, driven by the type table ────────────────────── */}
          {spec.fields.length > 0 ? (
            <>
              <Divider />
              <Typography variant="subtitle2">{t('notifications.channels.config')}</Typography>
              <Stack spacing={2}>
                {spec.fields.map((field) => {
                  const stored = maskedSecret(configPublic, field.name);
                  const helper =
                    errors[`config.${field.name}`] ??
                    (field.secret
                      ? draft.id && stored
                        ? t('notifications.channels.secretStored', { masked: stored })
                        : t('notifications.channels.secretHint')
                      : t(`notifications.channels.fieldHint.${field.name}`, { defaultValue: '' }) ||
                        undefined);

                  return (
                    <TextField
                      key={field.name}
                      size="small"
                      label={t(`notifications.channels.fields.${field.name}`)}
                      value={draft.config[field.name] ?? ''}
                      onChange={(event) => patchConfig(field.name, event.target.value)}
                      required={field.required && !field.secret}
                      multiline={field.control === 'list'}
                      minRows={field.control === 'list' ? 2 : undefined}
                      // "Leave empty to keep" is only true for a channel that
                      // already has a stored secret.
                      placeholder={
                        field.secret && draft.id
                          ? t('notifications.channels.secretPlaceholder')
                          : undefined
                      }
                      InputLabelProps={field.secret && draft.id ? { shrink: true } : undefined}
                      error={Boolean(errors[`config.${field.name}`])}
                      helperText={helper}
                      inputProps={{ 'data-testid': `cms-channel-config-${field.name}` }}
                    />
                  );
                })}
              </Stack>
            </>
          ) : null}

          {/* ── Templates ───────────────────────────────────────────── */}
          <Divider />
          <Stack spacing={1}>
            <Typography variant="subtitle2">{t('notifications.channels.templates')}</Typography>
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap alignItems="center">
              <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
                {t('notifications.channels.placeholders')}
              </Typography>
              {TEMPLATE_PLACEHOLDERS.map((name) => (
                <Tooltip key={name} title={t(`notifications.channels.placeholderHint.${name}`)}>
                  <Chip size="small" variant="outlined" label={`{{${name}}}`} />
                </Tooltip>
              ))}
            </Stack>

            <Tabs
              value={activeLanguage}
              onChange={(_event, value: string) => setTemplateLanguage(value)}
              variant="scrollable"
              scrollButtons="auto"
            >
              {languages.map((code) => (
                <Tab
                  key={code}
                  value={code}
                  label={languageLabels[code] ?? code}
                  data-testid={`cms-channel-template-tab-${code}`}
                />
              ))}
            </Tabs>

            <TextField
              size="small"
              label={t('notifications.channels.subject')}
              value={template.subject}
              onChange={(event) => patchTemplate({ subject: event.target.value })}
              inputProps={{ 'data-testid': 'cms-channel-template-subject' }}
            />
            <TextField
              size="small"
              label={t('notifications.channels.body')}
              value={template.body}
              onChange={(event) => patchTemplate({ body: event.target.value })}
              multiline
              minRows={4}
              inputProps={{ 'data-testid': 'cms-channel-template-body' }}
            />
          </Stack>

          {testResult ? (
            <Alert severity={testResult.ok ? 'success' : 'error'} data-testid="cms-channel-test-result">
              {testResult.message}
            </Alert>
          ) : null}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Tooltip title={draft.id ? '' : t('notifications.channels.testNeedsSave')}>
          <Box component="span">
            <Button
              startIcon={<SendIcon fontSize="small" />}
              onClick={onTest}
              disabled={!draft.id || testing}
              data-testid="cms-channel-test"
            >
              {t('notifications.channels.test')}
            </Button>
          </Box>
        </Tooltip>
        <Box sx={{ flexGrow: 1 }} />
        <Button onClick={onClose} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving}
          data-testid="cms-channel-save"
        >
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
