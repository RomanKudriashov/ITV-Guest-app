import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { currencyOptions, languageOptions, timezoneOptions } from '@/components/hotelFieldOptions';
import { pickTranslated } from '@/utils/translated';

import { ink, primaryButtonSx, quietButtonSx, typo } from './adminTokens';
import {
  AdminDialog,
  ChoiceField,
  ChoicePill,
  Field,
  FormCell,
  FormGrid,
  FormLabel,
  MultiChoiceField,
} from './form';
import {
  BRAND_PRESETS,
  checkSubdomain,
  createHotel,
  getHotelFieldReference,
  getTemplates,
  PlatformError,
  type CreateHotelResult,
} from './adminClient';

/** Адрес почты — по форме «x@y.z»; окончательно решает сервер. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Заведение отеля платформой.
 *
 * Пароль первого администратора показывается ОДИН раз и не хранится в открытом
 * виде: платформа заводит учётку, но не должна оставаться её владельцем.
 *
 * ВЫБОР, А НЕ ВВОД (партия 54). Пояс, валюта и языки вводились руками, и
 * сервер принимал почти всё: «Europe/Moskow» молча становился UTC, «rub» —
 * валютой. Теперь — списки с поиском из справочника сервера, а поддомен
 * проверяется на ходу: формат, запретное имя, занятость — до нажатия «Создать».
 */
export function CreateHotelDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (result: CreateHotelResult) => void;
}) {
  const { t, i18n } = useTranslation();
  const [form, setForm] = useState({
    subdomain: '',
    name: '',
    admin_email: '',
    currency: 'RUB',
    timezone: 'Europe/Moscow',
    preset: 'midnight_navy',
  });
  const [languages, setLanguages] = useState<string[]>(['ru', 'en']);
  const [template, setTemplate] = useState<string>('blank');
  const [error, setError] = useState<string | null>(null);
  const [emailTouched, setEmailTouched] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));
  const choose = (key: keyof typeof form) => (value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const consoleLanguage = (i18n.resolvedLanguage ?? i18n.language ?? 'en').split('-')[0];
  // Первый выбранный язык — язык отеля по умолчанию: на нём и заводится
  // контент, если консоль говорит на языке, которого у шаблона нет.
  const hotelLanguage = languages[0] || 'en';

  // Шаблоны редактируются платформой, поэтому список приходит с сервера, а не
  // зашит в диалог: иначе он отстал бы от реестра в первый же день.
  const templates = useQuery({ queryKey: ['admin', 'templates'], queryFn: () => getTemplates() });
  const reference = useQuery({
    queryKey: ['admin', 'reference', 'hotel-fields'],
    queryFn: getHotelFieldReference,
    staleTime: Infinity,
  });
  const timezones = useMemo(() => timezoneOptions(reference.data?.timezones ?? []), [reference.data]);
  const currencies = useMemo(
    () => currencyOptions((reference.data?.currencies ?? []).map((c) => c.code), consoleLanguage),
    [reference.data, consoleLanguage],
  );
  const languageChoices = useMemo(() => languageOptions(reference.data?.languages ?? []), [reference.data]);

  // Поддомен — на ходу, с паузой в 300 мс: каждая буква — не запрос.
  const subdomain = form.subdomain.trim().toLowerCase();
  const [asked, setAsked] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setAsked(subdomain), 300);
    return () => window.clearTimeout(timer);
  }, [subdomain]);
  const status = useQuery({
    queryKey: ['admin', 'subdomain-check', asked],
    queryFn: () => checkSubdomain(asked),
    enabled: asked.length > 0,
    staleTime: 0,
  });
  const settled = asked === subdomain && status.data?.value === subdomain;
  const rule = reference.data?.subdomain;
  const subdomainHelp = !subdomain
    ? t('admin.create.subdomainHint')
    : !settled
      ? t('admin.create.subdomainChecking')
      : status.data?.ok
        ? t('admin.create.subdomainFree', { host: `${subdomain}.${window.location.hostname.replace(/^www\./, '')}` })
        : t(`admin.create.${status.data?.code ?? 'subdomain_format'}`, { min: rule?.min ?? 3, max: rule?.max ?? 30 });
  const subdomainBad = Boolean(subdomain && settled && !status.data?.ok);

  const emailOk = EMAIL_RE.test(form.admin_email.trim());

  const mutation = useMutation({
    mutationFn: () =>
      createHotel({
        subdomain,
        name: form.name.trim(),
        admin_email: form.admin_email.trim(),
        currency: form.currency,
        timezone: form.timezone,
        languages,
        preset: form.preset,
        template,
      }),
    onSuccess: onCreated,
    onError: (e) => setError(e instanceof PlatformError ? e.message : t('admin.create.failed')),
  });

  const valid =
    Boolean(form.name.trim()) &&
    settled &&
    Boolean(status.data?.ok) &&
    emailOk &&
    languages.length > 0 &&
    Boolean(form.timezone) &&
    Boolean(form.currency);

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
          error={subdomainBad}
          helperText={<span data-testid="admin-create-subdomain-status">{subdomainHelp}</span>}
          inputProps={{
            'data-testid': 'admin-create-subdomain',
            'data-state': !subdomain ? 'empty' : !settled ? 'checking' : (status.data?.code ?? 'ok'),
          }}
        />
        <Field
          span={6}
          type="email"
          label={t('admin.create.adminEmail')}
          value={form.admin_email}
          onChange={set('admin_email')}
          onBlur={() => setEmailTouched(true)}
          error={emailTouched && Boolean(form.admin_email) && !emailOk}
          helperText={emailTouched && form.admin_email && !emailOk ? t('admin.create.emailInvalid') : ' '}
          inputProps={{ 'data-testid': 'admin-create-admin-email' }}
        />
        {/* Пополам с языками: «RUB — Российский рубль» в трети строки обрезался. */}
        <ChoiceField
          span={6}
          label={t('admin.create.currency')}
          value={form.currency}
          onChange={choose('currency')}
          options={currencies}
          loading={reference.isLoading}
          testId="admin-create-currency"
        />
        <MultiChoiceField
          span={6}
          label={t('admin.create.languages')}
          value={languages}
          onChange={setLanguages}
          options={languageChoices}
          loading={reference.isLoading}
          helperText={t('admin.create.languagesHint')}
          testId="admin-create-languages"
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
                  {/*
                    Язык консоли, потом ПЕРВЫЙ язык заводимого отеля, потом
                    код. Было `title.ru ?? title.en` — русский зашит первым, и
                    оператор нерусской платформы читал русские названия
                    шаблонов при том, что перевод на его язык лежал рядом.
                  */}
                  {pickTranslated(entry.title, consoleLanguage, hotelLanguage) || entry.code}
                </ChoicePill>
              ))}
          </Box>
        </FormCell>
        <ChoiceField
          span={6}
          label={t('admin.create.timezone')}
          value={form.timezone}
          onChange={choose('timezone')}
          options={timezones}
          loading={reference.isLoading}
          testId="admin-create-timezone"
        />
        <ChoiceField
          span={6}
          label={t('admin.create.preset')}
          value={form.preset}
          onChange={choose('preset')}
          options={BRAND_PRESETS.map((preset) => ({ value: preset, label: preset }))}
          testId="admin-create-preset"
        />
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
