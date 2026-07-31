import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { accent, ink, primaryButtonSx, surface } from './adminTokens';
import {
  BRAND_PRESETS,
  createHotel,
  getTemplates,
  PlatformError,
  type CreateHotelResult,
} from './adminClient';

/**
 * Заведение отеля платформой.
 *
 * Пароль первого администратора показывается ОДИН раз и не хранится в открытом
 * виде: платформа заводит учётку, но не должна оставаться её владельцем.
 */
export function CreateHotelDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (result: CreateHotelResult) => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    subdomain: '',
    name: '',
    admin_email: '',
    currency: 'RUB',
    timezone: 'Europe/Moscow',
    languages: 'ru,en',
    preset: 'midnight_navy',
  });
  const [template, setTemplate] = useState<string>('blank');
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  // Шаблоны редактируются платформой, поэтому список приходит с сервера, а не
  // зашит в диалог: иначе он отстал бы от реестра в первый же день.
  const templates = useQuery({ queryKey: ['admin', 'templates'], queryFn: getTemplates });

  const mutation = useMutation({
    mutationFn: () =>
      createHotel({
        subdomain: form.subdomain.trim(),
        name: form.name.trim(),
        admin_email: form.admin_email.trim(),
        currency: form.currency,
        timezone: form.timezone,
        languages: form.languages.split(',').map((code) => code.trim()).filter(Boolean),
        preset: form.preset,
        template,
      }),
    onSuccess: onCreated,
    onError: (e) => setError(e instanceof PlatformError ? e.message : t('admin.create.failed')),
  });

  const valid = form.subdomain && form.name && form.admin_email.includes('@');

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth data-testid="admin-create-dialog">
      <DialogTitle>{t('admin.create.title')}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error ? <Alert severity="error" data-testid="admin-create-error">{error}</Alert> : null}
          <TextField
            label={t('admin.create.name')}
            value={form.name}
            onChange={set('name')}
            inputProps={{ 'data-testid': 'admin-create-name' }}
          />
          <TextField
            label={t('admin.create.subdomain')}
            value={form.subdomain}
            onChange={set('subdomain')}
            helperText={t('admin.create.subdomainHint')}
            inputProps={{ 'data-testid': 'admin-create-subdomain' }}
          />
          <TextField
            label={t('admin.create.adminEmail')}
            value={form.admin_email}
            onChange={set('admin_email')}
            inputProps={{ 'data-testid': 'admin-create-admin-email' }}
          />
          <Stack direction="row" spacing={2}>
            <TextField
              label={t('admin.create.currency')}
              value={form.currency}
              onChange={set('currency')}
              sx={{ width: 120 }}
            />
            <TextField
              label={t('admin.create.languages')}
              value={form.languages}
              onChange={set('languages')}
              helperText={t('admin.create.languagesHint')}
              sx={{ flexGrow: 1 }}
            />
          </Stack>
          <Box>
            <Typography sx={{ fontSize: 11, fontWeight: 700, color: ink.mid, mb: 1 }}>
              {t('admin.create.template')}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {(templates.data ?? [])
                .filter((entry) => entry.is_active)
                .map((entry) => (
                  <Box
                    key={entry.code}
                    component="button"
                    type="button"
                    onClick={() => setTemplate(entry.code)}
                    data-testid={`admin-create-template-${entry.code}`}
                    data-active={template === entry.code ? 'true' : undefined}
                    sx={{
                      fontSize: 12,
                      fontWeight: 600,
                      px: 1.5,
                      py: 1,
                      borderRadius: 999,
                      cursor: 'pointer',
                      color: template === entry.code ? accent.soft : ink.mid,
                      bgcolor: template === entry.code ? accent.washSoft : 'transparent',
                      border: `1px solid ${template === entry.code ? accent.main : surface.line}`,
                    }}
                  >
                    {entry.title.ru ?? entry.title.en ?? entry.code}
                  </Box>
                ))}
            </Box>
          </Box>
          <Stack direction="row" spacing={2}>
            <TextField
              label={t('admin.create.timezone')}
              value={form.timezone}
              onChange={set('timezone')}
              sx={{ flexGrow: 1 }}
            />
            <TextField
              select
              label={t('admin.create.preset')}
              value={form.preset}
              onChange={set('preset')}
              sx={{ width: 210 }}
              SelectProps={{ inputProps: { 'data-testid': 'admin-create-preset' } }}
            >
              {BRAND_PRESETS.map((preset) => (
                <MenuItem key={preset} value={preset}>
                  {preset}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ color: ink.mid }}>
          {t('admin.actions.cancel')}
        </Button>
        <Button
          disabled={!valid || mutation.isPending}
          onClick={() => mutation.mutate()}
          data-testid="admin-create-submit"
          sx={primaryButtonSx}
        >
          {t('admin.create.submit')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Разовый показ пароля заведённого администратора. */
export function CreatedAdminDialog({
  admin,
  services,
  onClose,
}: {
  admin: CreateHotelResult['admin'];
  services: string[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open onClose={onClose} data-testid="admin-created-dialog">
      <DialogTitle>{t('admin.create.doneTitle')}</DialogTitle>
      <DialogContent>
        <Stack spacing={1} sx={{ pt: 1 }}>
          <Typography variant="body2">
            {t('admin.create.doneAdmin')}: <b>{admin.email}</b>
          </Typography>
          {admin.password ? (
            <Alert severity="info" data-testid="admin-created-password">
              {t('admin.create.donePassword')}: <b>{admin.password}</b>
            </Alert>
          ) : null}
          {services.length ? (
            <Box sx={{ fontSize: 12, color: ink.mid }} data-testid="admin-created-services">
              {t('admin.create.doneServices', { count: services.length })}: {services.join(', ')}
            </Box>
          ) : null}
          <Box sx={{ fontSize: 12, color: ink.low }}>{t('admin.create.doneHint')}</Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} data-testid="admin-created-done">
          {t('admin.actions.done')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
