import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { accent, ink, panelSx, pillSx, primaryButtonSx, surface } from '../adminTokens';
import {
  getDictionary,
  getTemplates,
  patchTemplate,
  putDictionaryEntry,
  type DictionaryEntry,
  type OnboardingTemplate,
} from '../adminClient';

const TABS = ['templates', 'dictionary'] as const;
type Tab = (typeof TABS)[number];

/**
 * Шаблоны онбординга и системный справочник — то, что платформа РЕДАКТИРУЕТ, а
 * не только использует.
 *
 * Оба реестра лежат в базе, а не в коде, по одной причине: они меняются не по
 * нашему релизному календарю. Шаблон подкручивают, глядя на живые отели;
 * список обязательных аллергенов диктует закон. Тариф, наоборот, остался
 * кодом — он связан с деньгами и обязан проходить ревью.
 */
export function TemplatesPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('templates');

  return (
    <Box data-testid="admin-templates">
      <Typography sx={{ fontSize: 24, fontWeight: 800, letterSpacing: '-.02em' }}>
        {t('admin.templates.title')}
      </Typography>
      <Typography sx={{ color: ink.low, fontSize: 13, mt: 0.5 }}>
        {t('admin.templates.subtitle')}
      </Typography>

      <Box sx={{ display: 'flex', gap: 0.5, mt: 2, borderBottom: `1px solid ${surface.line}` }}>
        {TABS.map((key) => (
          <ButtonBase
            key={key}
            onClick={() => setTab(key)}
            data-testid={`admin-templates-tab-${key}`}
            sx={{
              px: 1.75,
              py: 1.25,
              fontSize: 13,
              fontWeight: 700,
              color: tab === key ? accent.soft : ink.mid,
              borderBottom: `2px solid ${tab === key ? accent.main : 'transparent'}`,
            }}
          >
            {t(`admin.templates.tab.${key}`)}
          </ButtonBase>
        ))}
      </Box>

      <Box sx={{ mt: 2.25 }}>
        {tab === 'templates' ? <TemplatesTab /> : <DictionaryTab />}
      </Box>
    </Box>
  );
}

function TemplatesTab() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const templates = useQuery({ queryKey: ['admin', 'templates'], queryFn: getTemplates });
  const save = useMutation({
    mutationFn: (body: { id: string; patch: Partial<OnboardingTemplate> }) =>
      patchTemplate(body.id, body.patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'templates'] }),
  });

  if (!templates.data) return <CircularProgress />;

  return (
    <Box sx={{ display: 'grid', gap: 1.75 }}>
      {templates.data.map((template) => (
        <Box key={template.id} sx={panelSx} data-testid={`admin-template-${template.code}`}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{ flexGrow: 1 }}>
              <Typography sx={{ fontSize: 14, fontWeight: 700, color: ink.hi }}>
                {template.title[i18n.language] ?? template.title.en ?? template.code}
              </Typography>
              <Typography sx={{ fontSize: 12, color: ink.low, mt: 0.4 }}>
                {template.description[i18n.language] ?? template.description.en ?? ''}
              </Typography>
            </Box>
            <Box
              sx={{
                fontSize: 10.5,
                fontWeight: 700,
                px: 1.1,
                py: 0.4,
                borderRadius: 999,
                ...pillSx(template.is_active ? 'ok' : 'muted'),
              }}
            >
              {template.tariff || '—'}
            </Box>
            <Switch
              checked={template.is_active}
              onChange={(e) => save.mutate({ id: template.id, patch: { is_active: e.target.checked } })}
              inputProps={{ 'data-testid': `admin-template-active-${template.code}` } as Record<string, string>}
            />
          </Box>

          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 1.25 }}>
            {template.services.length === 0 ? (
              <Typography sx={{ fontSize: 12, color: ink.low }}>{t('admin.templates.noServices')}</Typography>
            ) : (
              template.services.map((service, index) => (
                <Box
                  key={`${service.type}-${index}`}
                  sx={{
                    fontSize: 11.5,
                    color: ink.mid,
                    px: 1.1,
                    py: 0.5,
                    borderRadius: 999,
                    border: `1px solid ${surface.line}`,
                  }}
                >
                  {service.name[i18n.language] ?? service.name.en ?? service.type}
                </Box>
              ))
            )}
          </Box>

          {template.modules.length ? (
            <Typography sx={{ fontSize: 11.5, color: ink.low, mt: 1 }}>
              {t('admin.templates.modules')}:{' '}
              {template.modules.map((code) => t(`admin.module.${code}`, { defaultValue: code })).join(' · ')}
            </Typography>
          ) : null}
        </Box>
      ))}
      <Typography sx={{ fontSize: 11.5, color: ink.low }}>{t('admin.templates.note')}</Typography>
    </Box>
  );
}

function DictionaryTab() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const dictionary = useQuery({ queryKey: ['admin', 'dictionary'], queryFn: getDictionary });
  const [kind, setKind] = useState('allergen');
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: { kind: string; code: string; title: Record<string, string>; is_active?: boolean }) =>
      putDictionaryEntry(body),
    onSuccess: () => {
      setCode('');
      setTitle('');
      setError(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'dictionary'] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : t('admin.templates.dictFailed')),
  });

  if (!dictionary.data) return <CircularProgress />;

  const grouped: Record<string, DictionaryEntry[]> = {};
  dictionary.data.forEach((entry) => {
    (grouped[entry.kind] ??= []).push(entry);
  });

  return (
    <Box>
      <Box sx={{ ...panelSx, display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          select
          size="small"
          label={t('admin.templates.dictKind')}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          SelectProps={{ inputProps: { 'data-testid': 'admin-dict-kind' } }}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="allergen">{t('admin.templates.kind.allergen')}</MenuItem>
          <MenuItem value="marker">{t('admin.templates.kind.marker')}</MenuItem>
        </TextField>
        <TextField
          size="small"
          label={t('admin.templates.dictCode')}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputProps={{ 'data-testid': 'admin-dict-code' }}
        />
        <TextField
          size="small"
          label={t('admin.templates.dictTitle')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          inputProps={{ 'data-testid': 'admin-dict-title' }}
          sx={{ minWidth: 220 }}
        />
        <Button
          disabled={!code.trim() || !title.trim() || save.isPending}
          onClick={() =>
            save.mutate({ kind, code: code.trim(), title: { [i18n.language]: title.trim() } })
          }
          data-testid="admin-dict-save"
          sx={primaryButtonSx}
        >
          {t('admin.templates.dictSave')}
        </Button>
      </Box>
      {error ? <Alert severity="error" sx={{ mt: 1.5 }}>{error}</Alert> : null}

      {Object.entries(grouped).map(([entryKind, entries]) => (
        <Box key={entryKind} sx={{ mt: 2 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 700, color: ink.low, textTransform: 'uppercase', letterSpacing: '.12em' }}>
            {t(`admin.templates.kind.${entryKind}`)}
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 1 }}>
            {entries.map((entry) => (
              <Box
                key={entry.id}
                data-testid={`admin-dict-${entry.kind}-${entry.code}`}
                sx={{
                  fontSize: 11.5,
                  px: 1.2,
                  py: 0.6,
                  borderRadius: 999,
                  border: `1px solid ${surface.line}`,
                  color: entry.is_active ? ink.mid : ink.low,
                  opacity: entry.is_active ? 1 : 0.55,
                }}
              >
                {entry.title[i18n.language] ?? entry.title.en ?? entry.code}
              </Box>
            ))}
          </Box>
        </Box>
      ))}

      <Typography sx={{ fontSize: 11.5, color: ink.low, mt: 2 }}>
        {t('admin.templates.dictNote')}
      </Typography>
    </Box>
  );
}
