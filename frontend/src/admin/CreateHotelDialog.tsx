import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { ink, primaryButtonSx, quietButtonSx, typo } from './adminTokens';
import { AdminDialog, ChoicePill, Field, FormCell, FormGrid, FormLabel } from './form';
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
  const templates = useQuery({ queryKey: ['admin', 'templates'], queryFn: () => getTemplates() });

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
    <AdminDialog
      testId="admin-create-dialog"
      title={t('admin.create.title')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose} sx={quietButtonSx}>
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
        </>
      }
    >
      <FormGrid>
        {error ? (
          <FormCell>
            <Alert severity="error" data-testid="admin-create-error">
              {error}
            </Alert>
          </FormCell>
        ) : null}
        <Field
          span={12}
          label={t('admin.create.name')}
          value={form.name}
          onChange={set('name')}
          inputProps={{ 'data-testid': 'admin-create-name' }}
        />
        <Field
          span={6}
          label={t('admin.create.subdomain')}
          value={form.subdomain}
          onChange={set('subdomain')}
          helperText={t('admin.create.subdomainHint')}
          inputProps={{ 'data-testid': 'admin-create-subdomain' }}
        />
        <Field
          span={6}
          label={t('admin.create.adminEmail')}
          value={form.admin_email}
          onChange={set('admin_email')}
          inputProps={{ 'data-testid': 'admin-create-admin-email' }}
        />
        <Field
          span={3}
          label={t('admin.create.currency')}
          value={form.currency}
          onChange={set('currency')}
        />
        <Field
          span={9}
          label={t('admin.create.languages')}
          value={form.languages}
          onChange={set('languages')}
          helperText={t('admin.create.languagesHint')}
        />
        <FormCell>
          <FormLabel>{t('admin.create.template')}</FormLabel>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {(templates.data?.items ?? [])
              .filter((entry) => entry.is_active)
              .map((entry) => (
                <ChoicePill
                  key={entry.code}
                  active={template === entry.code}
                  onClick={() => setTemplate(entry.code)}
                  testId={`admin-create-template-${entry.code}`}
                >
                  {entry.title.ru ?? entry.title.en ?? entry.code}
                </ChoicePill>
              ))}
          </Box>
        </FormCell>
        <Field
          span={6}
          label={t('admin.create.timezone')}
          value={form.timezone}
          onChange={set('timezone')}
        />
        <Field
          span={6}
          select
          label={t('admin.create.preset')}
          value={form.preset}
          onChange={set('preset')}
          SelectProps={{ inputProps: { 'data-testid': 'admin-create-preset' } }}
        >
          {BRAND_PRESETS.map((preset) => (
            <MenuItem key={preset} value={preset}>
              {preset}
            </MenuItem>
          ))}
        </Field>
      </FormGrid>
    </AdminDialog>
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
    <AdminDialog
      testId="admin-created-dialog"
      title={t('admin.create.doneTitle')}
      onClose={onClose}
      maxWidth="xs"
      actions={
        <Button onClick={onClose} data-testid="admin-created-done" sx={primaryButtonSx}>
          {t('admin.actions.done')}
        </Button>
      }
    >
      <Stack spacing={1.5}>
        <Typography sx={{ ...typo.body, color: ink.hi }}>
          {t('admin.create.doneAdmin')}: <b>{admin.email}</b>
        </Typography>
        <Alert severity="success" data-testid="admin-created-sent">
          {t('admin.create.donePasswordSent', { email: admin.delivered_to })}
        </Alert>
        {services.length ? (
          <Box sx={{ ...typo.caption, color: ink.mid }} data-testid="admin-created-services">
            {t('admin.create.doneServices', { count: services.length })}: {services.join(', ')}
          </Box>
        ) : null}
        <Box sx={{ ...typo.caption, color: ink.low }}>{t('admin.create.doneHint')}</Box>
      </Stack>
    </AdminDialog>
  );
}
