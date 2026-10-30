import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { useTranslation } from 'react-i18next';

import { queryKeys } from '@/api/queryKeys';
import { SelectField } from '@/components/SelectField';
import { ImportTab } from '@/cms/roomControl/ImportTab';
import { useGrms, useGrmsScope } from '@/cms/roomControl/scope';
import { accent, fieldSx, ink, primaryButtonSx, quietButtonSx, secondaryButtonSx, shape, state, surface, typo } from '../../adminTokens';
import { AdminDialog } from '../../form';
import {
  PlatformError,
  addButton,
  addZone,
  createVariant,
  deleteVariant,
  getButtons,
  getChannels,
  getCopySources,
  linkChannel,
  orderButtons,
  orderZones,
  publishVariant,
  removeButton,
  removeZone,
  renameZone,
  rollbackVariant,
  testCommand,
  unlinkChannel,
  updateButton,
  updateVariantBase,
  type ChannelOption,
  type TestResult,
  type VariantButton,
  type VariantCard,
  type VariantDiff,
} from '../../adminClient';
import { useRights } from '../../useRights';
import { Help, Pill } from '../hotels/hotelsUi';

/**
 * ПРАВКА ВАРИАНТА (партия 63-4, шаг B): окна и формы шагов.
 *
 * Слова — только экранные; коды видов, возможностей и каналов показываются
 * лишь в блоке «Для инженера» и в выборе канала, где имя канала и есть
 * предмет разговора (обёрнуты `data-words="data"`).
 */

export const KINDS = ['light_group', 'curtain', 'curtain_blackout', 'air_conditioner', 'heating', 'scene', 'dnd', 'mur', 'laundry', 'sos', 'master_switch'] as const;
export const pick = (title: Record<string, string> | undefined, lang: string) => (title ? title[lang] || title.ru || Object.values(title)[0] || '' : '');

/** Слово ошибки по коду сервера; незнакомый код — фраза сервера как есть. */
export function useErrorWords() {
  const { t } = useTranslation();
  return (error: unknown) => {
    if (error instanceof PlatformError && error.code) {
      const data = (error.data ?? {}) as Record<string, unknown>;
      const word = t(`admin.variants.err.${error.code}`, { ...data, defaultValue: '' });
      if (word) return word;
    }
    return error instanceof Error ? error.message : String(error);
  };
}

export function useVariantRefresh(hotelId: string, code?: string) {
  const qc = useQueryClient();
  const grms = useGrms();
  return () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'variants', hotelId] });
    void qc.invalidateQueries({ queryKey: queryKeys.grmsTypes(grms.base) });
    void qc.invalidateQueries({ queryKey: ['admin', 'readiness', hotelId] });
    void qc.invalidateQueries({ queryKey: ['admin', 'hotel-rooms-map', hotelId] });
    if (code) {
      void qc.invalidateQueries({ queryKey: ['admin', 'variant-diff', hotelId, code] });
      void qc.invalidateQueries({ queryKey: ['admin', 'variant-buttons', hotelId, code] });
      void qc.invalidateQueries({ queryKey: queryKeys.grmsStatus(grms.base, code) });
      void qc.invalidateQueries({ queryKey: queryKeys.grmsPlan(grms.base, code) });
      void qc.invalidateQueries({ queryKey: queryKeys.grmsVersions(grms.base, code) });
    }
  };
}

function Err({ error }: { error: unknown }) {
  const words = useErrorWords();
  if (!error) return null;
  return (
    <Typography sx={{ ...typo.caption, color: state.bad }} data-testid="admin-variant-error">
      {words(error)}
    </Typography>
  );
}

function Label({ text, help }: { text: string; help?: string }) {
  return (
    <Box sx={{ ...typo.label, color: ink.mid, mb: 0.75, display: 'flex', alignItems: 'center', gap: 0.5 }}>
      {text}
      {help ? <Help>{help}</Help> : null}
    </Box>
  );
}

export function Chips<V extends string>({ value, options, onChange, testId }: { value: V; options: Array<[V, ReactNode]>; onChange: (v: V) => void; testId: string }) {
  return (
    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }} role="radiogroup">
      {options.map(([key, label]) => (
        <ButtonBase
          key={key}
          role="radio"
          aria-checked={value === key}
          onClick={() => onChange(key)}
          data-testid={`${testId}-${key}`}
          sx={{ px: 1.25, py: 0.6, borderRadius: `${shape.pill}px`, ...typo.caption, fontWeight: 700, border: `1px solid ${value === key ? accent.main : surface.line}`, color: value === key ? accent.soft : ink.mid, bgcolor: value === key ? accent.washSoft : 'transparent' }}
        >
          {label}
        </ButtonBase>
      ))}
    </Box>
  );
}

/** Название по языкам отеля: первый — обязательный. */
export function TitleFields({ value, onChange, testId, placeholder }: { value: Record<string, string>; onChange: (v: Record<string, string>) => void; testId: string; placeholder?: string }) {
  const { t } = useTranslation();
  const { languages } = useGrmsScope();
  const codes = languages.codes.length ? languages.codes : ['ru'];
  return (
    <Box sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: { xs: '1fr', sm: codes.length > 1 ? '1fr 1fr' : '1fr' } }}>
      {codes.map((lang) => (
        <TextField
          key={lang}
          size="small"
          label={t(`admin.variants.lang.${lang}`, { defaultValue: t('admin.variants.lang.other') })}
          value={value[lang] ?? ''}
          placeholder={placeholder}
          onChange={(e) => onChange({ ...value, [lang]: e.target.value.slice(0, 120) })}
          sx={fieldSx}
          InputLabelProps={{ shrink: true }}
          inputProps={{ 'data-testid': `${testId}-${lang}`, 'data-words': 'data' }}
        />
      ))}
    </Box>
  );
}

const VIEWS = ['tiles', 'simple', 'full'] as const;

function ViewChoice({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  return (
    <Box>
      <Label text={t('admin.variants.base.view')} help={t('admin.variants.base.viewHelp')} />
      <Chips value={value as 'tiles'} onChange={onChange} testId="admin-variant-view" options={VIEWS.map((v) => [v, t(`admin.variants.view.${v}`)])} />
      <Box sx={{ ...typo.caption, color: ink.mid, mt: 0.75 }}>{t(`admin.variants.base.viewAbout.${value}`)}</Box>
    </Box>
  );
}

/* ── Новый вариант ──────────────────────────────────────────────────────── */

type NewMode = 'blank' | 'file' | 'copy' | 'copy_other';

export function NewVariantDialog({ hotelId, variants, onClose, onCreated }: { hotelId: string; variants: VariantCard[]; onClose: () => void; onCreated: (code: string | null) => void }) {
  const { t, i18n } = useTranslation();
  const refresh = useVariantRefresh(hotelId);
  const k = 'admin.variants.new';
  const [mode, setMode] = useState<NewMode>('blank');
  const [title, setTitle] = useState<Record<string, string>>({});
  const [view, setView] = useState('tiles');
  const [source, setSource] = useState(variants[0]?.code ?? '');
  const [otherHotel, setOtherHotel] = useState('');
  const [otherVariant, setOtherVariant] = useState('');
  const sources = useQuery({ queryKey: ['admin', 'variant-sources', hotelId], queryFn: () => getCopySources(hotelId), enabled: mode === 'copy_other' });
  const hotel = sources.data?.hotels.find((h) => h.hotel_id === otherHotel) ?? sources.data?.hotels[0];
  const donor = hotel?.variants.find((v) => v.code === otherVariant) ?? hotel?.variants[0];
  const create = useMutation({
    mutationFn: () =>
      createVariant(hotelId, {
        title,
        plan_level: view,
        ...(mode === 'copy' ? { source } : {}),
        ...(mode === 'copy_other' && hotel && donor ? { source: donor.code, source_hotel: hotel.hotel_id } : {}),
      }),
    onSuccess: (r) => {
      refresh();
      onCreated(r.code);
    },
  });
  const hasTitle = Object.values(title).some((v) => v.trim());
  const ready = hasTitle && (mode === 'blank' || (mode === 'copy' && source) || (mode === 'copy_other' && donor));
  return (
    <AdminDialog
      title={t(`${k}.title`)}
      onClose={onClose}
      testId="admin-variant-new"
      maxWidth="md"
      actions={
        mode === 'file' ? (
          <Button sx={secondaryButtonSx} onClick={onClose}>{t('admin.variants.close')}</Button>
        ) : (
          <>
            <Button sx={secondaryButtonSx} onClick={onClose}>{t('admin.variants.cancel')}</Button>
            <Button sx={primaryButtonSx} disabled={!ready || create.isPending} onClick={() => create.mutate()} data-testid="admin-variant-new-create">
              {t(`${k}.create`)}
            </Button>
          </>
        )
      }
    >
      <Box sx={{ display: 'grid', gap: 2 }}>
        <Chips<NewMode>
          value={mode}
          onChange={setMode}
          testId="admin-variant-new-mode"
          options={(['blank', 'file', 'copy', 'copy_other'] as NewMode[]).filter((m) => m !== 'copy' || variants.length).map((m) => [m, t(`${k}.mode.${m}`)])}
        />
        <Box sx={{ ...typo.caption, color: ink.mid }}>{t(`${k}.about.${mode}`)}</Box>
        {mode === 'file' ? (
          <ImportTab
            onImported={() => {
              refresh();
              onCreated(null);
            }}
          />
        ) : (
          <>
            {mode === 'copy' ? (
              <SelectField
                label={t(`${k}.source`)}
                value={source}
                onChange={(v) => {
                  setSource(v);
                  const from = variants.find((x) => x.code === v);
                  if (from && !hasTitle) setTitle({ ru: `${pick(from.title, 'ru')} — ${t(`${k}.copySuffix`)}` });
                }}
                options={variants.map((v) => ({ value: v.code, label: pick(v.title, i18n.language) || v.code }))}
                testId="admin-variant-new-source"
                fieldSx={fieldSx}
              />
            ) : null}
            {mode === 'copy_other' ? (
              sources.data && !sources.data.hotels.length ? (
                <Box sx={{ ...typo.body, color: ink.mid }}>{t(`${k}.noSources`)}</Box>
              ) : (
                <Box sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
                  <SelectField
                    label={t(`${k}.otherHotel`)}
                    value={hotel?.hotel_id ?? ''}
                    onChange={(v) => {
                      setOtherHotel(v);
                      setOtherVariant('');
                    }}
                    options={(sources.data?.hotels ?? []).map((h) => ({ value: h.hotel_id, label: h.hotel }))}
                    testId="admin-variant-new-hotel"
                    fieldSx={fieldSx}
                  />
                  <SelectField
                    label={t(`${k}.source`)}
                    value={donor?.code ?? ''}
                    onChange={setOtherVariant}
                    options={(hotel?.variants ?? []).map((v) => ({ value: v.code, label: `${pick(v.title, i18n.language) || v.code} · ${t('admin.variants.buttonsCount', { count: v.buttons })}` }))}
                    testId="admin-variant-new-other"
                    fieldSx={fieldSx}
                  />
                </Box>
              )
            ) : null}
            <Box>
              <Label text={t('admin.variants.base.title')} help={t('admin.variants.base.titleHelp')} />
              <TitleFields value={title} onChange={setTitle} testId="admin-variant-new-title" />
            </Box>
            {mode === 'blank' ? <ViewChoice value={view} onChange={setView} /> : null}
            {mode !== 'blank' ? <Box sx={{ ...typo.caption, color: ink.mid }}>{t(`${k}.copyNote`)}</Box> : null}
            <Err error={create.error} />
          </>
        )}
      </Box>
    </AdminDialog>
  );
}

/* ── Основа: правка ─────────────────────────────────────────────────────── */

export function BaseEdit({ hotelId, v, onDone }: { hotelId: string; v: VariantCard; onDone: () => void }) {
  const { t } = useTranslation();
  const refresh = useVariantRefresh(hotelId, v.code);
  const [title, setTitle] = useState<Record<string, string>>({ ...v.title });
  const [notes, setNotes] = useState(v.notes);
  const [view, setView] = useState<string>(v.plan_level);
  const [device, setDevice] = useState(v.device_template);
  const save = useMutation({
    mutationFn: () => updateVariantBase(hotelId, v.code, { title, notes, plan_level: view, device_name_template: device }),
    onSuccess: () => {
      refresh();
      onDone();
    },
  });
  const k = 'admin.variants.base';
  return (
    <Box sx={{ display: 'grid', gap: 2 }} data-testid="admin-variant-base-form">
      <Box>
        <Label text={t(`${k}.title`)} help={t(`${k}.titleHelp`)} />
        <TitleFields value={title} onChange={setTitle} testId="admin-variant-title" />
      </Box>
      <TextField size="small" label={t(`${k}.notes`)} value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 2000))} multiline minRows={2} sx={fieldSx} inputProps={{ 'data-testid': 'admin-variant-notes', 'data-words': 'data' }} />
      <ViewChoice value={view} onChange={setView} />
      <TextField
        size="small"
        label={
          <Box component="span" sx={{ display: 'inline-flex', gap: 0.5, alignItems: 'center' }}>
            {t(`${k}.device`)}
            <Help>{t(`${k}.deviceHelp`)}</Help>
          </Box>
        }
        value={device}
        onChange={(e) => setDevice(e.target.value.slice(0, 255))}
        sx={fieldSx}
        InputLabelProps={{ shrink: true }}
        inputProps={{ 'data-testid': 'admin-variant-device', 'data-words': 'data' }}
      />
      <Err error={save.error} />
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button sx={primaryButtonSx} disabled={save.isPending || !Object.values(title).some((x) => x.trim())} onClick={() => save.mutate()} data-testid="admin-variant-base-save">
          {t('admin.variants.save')}
        </Button>
        <Button sx={secondaryButtonSx} onClick={onDone}>{t('admin.variants.cancel')}</Button>
      </Box>
    </Box>
  );
}

/** Удалить вариант: с номерами — нельзя, и сказано, куда их деть. */
export function DeleteVariant({ hotelId, v, onDeleted, onToRooms }: { hotelId: string; v: VariantCard; onDeleted: () => void; onToRooms: () => void }) {
  const { t, i18n } = useTranslation();
  const refresh = useVariantRefresh(hotelId);
  const [open, setOpen] = useState(false);
  const remove = useMutation({
    mutationFn: () => deleteVariant(hotelId, v.code),
    onSuccess: () => {
      refresh();
      onDeleted();
    },
  });
  const k = 'admin.variants.delete';
  return (
    <>
      <Button size="small" sx={{ ...quietButtonSx, color: state.bad }} startIcon={<DeleteOutlineIcon fontSize="small" />} onClick={() => setOpen(true)} data-testid="admin-variant-delete">
        {t(`${k}.button`)}
      </Button>
      {open ? (
        <AdminDialog
          title={t(`${k}.title`, { name: pick(v.title, i18n.language) })}
          onClose={() => setOpen(false)}
          testId="admin-variant-delete-dialog"
          actions={
            v.rooms ? (
              <>
                <Button sx={secondaryButtonSx} onClick={() => setOpen(false)}>{t('admin.variants.cancel')}</Button>
                <Button
                  sx={primaryButtonSx}
                  onClick={() => {
                    setOpen(false);
                    onToRooms();
                  }}
                  data-testid="admin-variant-delete-to-rooms"
                >
                  {t(`${k}.toRooms`)}
                </Button>
              </>
            ) : (
              <>
                <Button sx={secondaryButtonSx} onClick={() => setOpen(false)}>{t('admin.variants.cancel')}</Button>
                <Button sx={{ ...primaryButtonSx, bgcolor: state.bad, '&:hover': { bgcolor: state.bad } }} disabled={remove.isPending} onClick={() => remove.mutate()} data-testid="admin-variant-delete-confirm">
                  {t(`${k}.confirm`)}
                </Button>
              </>
            )
          }
        >
          <Box sx={{ ...typo.body, color: ink.hi, display: 'grid', gap: 1 }}>
            {v.rooms ? <Box data-testid="admin-variant-delete-blocked">{t(`${k}.hasRooms`, { count: v.rooms })}</Box> : <Box>{t(`${k}.sure`)}</Box>}
            <Err error={remove.error} />
          </Box>
        </AdminDialog>
      ) : null}
    </>
  );
}

/* ── Зоны ───────────────────────────────────────────────────────────────── */

export function ZonesEdit({ hotelId, code, zones, counts }: { hotelId: string; code: string; zones: Array<{ code: string; title: Record<string, string> }>; counts: Record<string, number> }) {
  const { t, i18n } = useTranslation();
  const { canWrite } = useRights();
  const refresh = useVariantRefresh(hotelId, code);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState<string | null>(null);
  const k = 'admin.variants.zones';
  const done = { onSuccess: () => { refresh(); setEditing(null); setRemoving(null); } };
  const add = useMutation({ mutationFn: () => addZone(hotelId, code, draft), ...done });
  const rename = useMutation({ mutationFn: (zone: string) => renameZone(hotelId, code, zone, draft), ...done });
  const remove = useMutation({ mutationFn: (zone: string) => removeZone(hotelId, code, zone), ...done });
  const order = useMutation({ mutationFn: (items: string[]) => orderZones(hotelId, code, items), onSuccess: refresh });
  const move = (i: number, d: number) => {
    const list = zones.map((z) => z.code);
    [list[i], list[i + d]] = [list[i + d], list[i]];
    order.mutate(list);
  };
  return (
    <Box sx={{ display: 'grid', gap: 0.75 }} data-testid="admin-variant-zones">
      <Label text={t(`${k}.title`)} help={t(`${k}.help`)} />
      {zones.map((z, i) => (
        <Box key={z.code} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, borderBottom: `1px solid ${surface.hair}`, flexWrap: 'wrap' }} data-testid={`admin-variant-zone-row-${z.code}`}>
          {editing === z.code ? (
            <Box sx={{ flex: 1, display: 'grid', gap: 1 }}>
              <TitleFields value={draft} onChange={setDraft} testId="admin-variant-zone-title" />
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button size="small" sx={primaryButtonSx} disabled={rename.isPending} onClick={() => rename.mutate(z.code)} data-testid="admin-variant-zone-save">{t('admin.variants.save')}</Button>
                <Button size="small" sx={secondaryButtonSx} onClick={() => setEditing(null)}>{t('admin.variants.cancel')}</Button>
              </Box>
            </Box>
          ) : (
            <>
              <Box sx={{ flex: 1, ...typo.body, color: ink.hi }}>
                <span data-words="data">{pick(z.title, i18n.language) || t('admin.variants.plan.zoneUnnamed')}</span>
                <Box component="span" sx={{ color: ink.mid, ...typo.caption }}> · {t('admin.variants.buttonsCount', { count: counts[z.code] ?? 0 })}</Box>
              </Box>
              {canWrite ? (
                <Box sx={{ display: 'flex', gap: 0.25 }}>
                  <IconButton size="small" disabled={i === 0 || order.isPending} onClick={() => move(i, -1)} aria-label={t('admin.variants.up')}><ArrowUpwardIcon fontSize="small" /></IconButton>
                  <IconButton size="small" disabled={i === zones.length - 1 || order.isPending} onClick={() => move(i, 1)} aria-label={t('admin.variants.down')}><ArrowDownwardIcon fontSize="small" /></IconButton>
                  <IconButton size="small" onClick={() => { setDraft({ ...z.title }); setEditing(z.code); }} aria-label={t('admin.variants.edit')} data-testid={`admin-variant-zone-edit-${z.code}`}><EditOutlinedIcon fontSize="small" /></IconButton>
                  <IconButton size="small" onClick={() => setRemoving(z.code)} aria-label={t('admin.variants.remove')} data-testid={`admin-variant-zone-remove-${z.code}`}><DeleteOutlineIcon fontSize="small" /></IconButton>
                </Box>
              ) : null}
            </>
          )}
        </Box>
      ))}
      {!zones.length ? <Box sx={{ ...typo.caption, color: ink.mid }}>{t(`${k}.none`)}</Box> : null}
      {canWrite ? (
        editing === '__new__' ? (
          <Box sx={{ display: 'grid', gap: 1, mt: 1 }}>
            <TitleFields value={draft} onChange={setDraft} testId="admin-variant-zone-new" />
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button size="small" sx={primaryButtonSx} disabled={add.isPending || !Object.values(draft).some((x) => x.trim())} onClick={() => add.mutate()} data-testid="admin-variant-zone-add-save">{t('admin.variants.save')}</Button>
              <Button size="small" sx={secondaryButtonSx} onClick={() => setEditing(null)}>{t('admin.variants.cancel')}</Button>
            </Box>
          </Box>
        ) : (
          <Box>
            <Button size="small" sx={secondaryButtonSx} onClick={() => { setDraft({}); setEditing('__new__'); }} data-testid="admin-variant-zone-add">{t(`${k}.add`)}</Button>
          </Box>
        )
      ) : null}
      <Err error={add.error || rename.error || remove.error || order.error} />
      {removing ? (
        <AdminDialog
          title={t(`${k}.removeTitle`, { name: pick(zones.find((z) => z.code === removing)?.title, i18n.language) })}
          onClose={() => setRemoving(null)}
          testId="admin-variant-zone-remove-dialog"
          actions={
            <>
              <Button sx={secondaryButtonSx} onClick={() => setRemoving(null)}>{t('admin.variants.cancel')}</Button>
              <Button sx={{ ...primaryButtonSx, bgcolor: state.bad, '&:hover': { bgcolor: state.bad } }} disabled={remove.isPending} onClick={() => remove.mutate(removing)} data-testid="admin-variant-zone-remove-confirm">{t('admin.variants.remove')}</Button>
            </>
          }
        >
          <Box sx={{ ...typo.body, color: ink.hi }}>{t(`${k}.removeAbout`, { count: counts[removing] ?? 0 })}</Box>
        </AdminDialog>
      ) : null}
    </Box>
  );
}

/* ── Кнопки ─────────────────────────────────────────────────────────────── */

export function useButtons(hotelId: string, code: string) {
  return useQuery({ queryKey: ['admin', 'variant-buttons', hotelId, code], queryFn: () => getButtons(hotelId, code) });
}

export function buttonLabel(t: (k: string, o?: Record<string, unknown>) => string, b: { title: Record<string, string>; kind: string }, lang: string) {
  return pick(b.title, lang) || t(`admin.variants.kind.${b.kind}`, { defaultValue: t('admin.variants.kind.other') });
}

export function ButtonsEdit({ hotelId, code, zones }: { hotelId: string; code: string; zones: Array<{ code: string; title: Record<string, string> }> }) {
  const { t, i18n } = useTranslation();
  const { canWrite } = useRights();
  const refresh = useVariantRefresh(hotelId, code);
  const list = useButtons(hotelId, code);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [removing, setRemoving] = useState<VariantButton | null>(null);
  const order = useMutation({ mutationFn: (items: string[]) => orderButtons(hotelId, code, items), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (slug: string) => removeButton(hotelId, code, slug), onSuccess: () => { refresh(); setRemoving(null); } });
  const k = 'admin.variants.buttons';
  const buttons = list.data?.buttons ?? [];
  const groups = [...zones.map((z) => ({ code: z.code, title: pick(z.title, i18n.language) })), { code: '', title: t(`${k}.noZone`) }]
    .map((z) => ({ ...z, items: buttons.filter((b) => b.zone === z.code) }))
    .filter((z) => z.items.length);
  const move = (slug: string, d: number) => {
    const all = buttons.map((b) => b.slug);
    const i = all.indexOf(slug);
    if (i + d < 0 || i + d >= all.length) return;
    [all[i], all[i + d]] = [all[i + d], all[i]];
    order.mutate(all);
  };
  const ability = (cap: string) => t(`admin.variants.ability.${cap}`, { defaultValue: cap });
  return (
    <Box sx={{ display: 'grid', gap: 1.5 }} data-testid="admin-variant-buttons-edit">
      {groups.map((z) => (
        <Box key={z.code || '-'}>
          <Box sx={{ ...typo.label, color: ink.mid, mb: 0.5 }} data-words="data">{z.title}</Box>
          {z.items.map((b) => (
            <Box key={b.slug} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.6, borderBottom: `1px solid ${surface.hair}`, flexWrap: 'wrap' }} data-testid={`admin-variant-button-${b.slug}`} data-ready={b.publishable ? 'true' : 'false'}>
              <Box sx={{ flex: '1 1 220px', minWidth: 0 }}>
                <Box sx={{ ...typo.body, color: ink.hi, fontWeight: 600 }}>
                  <span data-words="data">{buttonLabel(t, b, i18n.language)}</span>
                  <Box component="span" sx={{ ...typo.caption, color: ink.mid, fontWeight: 400 }}> · {t(`admin.variants.kind.${b.kind}`, { defaultValue: t('admin.variants.kind.other') })}</Box>
                </Box>
                {b.missing.length ? (
                  <Box sx={{ ...typo.caption, color: state.warn }}>{t(`${k}.missing`, { list: b.missing.map(ability).join(', ') })}</Box>
                ) : b.warnings ? (
                  <Box sx={{ ...typo.caption, color: state.warn }}>{t(`${k}.senseWarn`)}</Box>
                ) : !b.publishable ? (
                  <Box sx={{ ...typo.caption, color: state.warn }}>{t(`${k}.formWarn`)}</Box>
                ) : (
                  <Box sx={{ ...typo.caption, color: state.ok }}>{t(`${k}.ready`)}</Box>
                )}
              </Box>
              {canWrite ? (
                <Box sx={{ display: 'flex', gap: 0.25 }}>
                  <IconButton size="small" disabled={order.isPending} onClick={() => move(b.slug, -1)} aria-label={t('admin.variants.up')}><ArrowUpwardIcon fontSize="small" /></IconButton>
                  <IconButton size="small" disabled={order.isPending} onClick={() => move(b.slug, 1)} aria-label={t('admin.variants.down')}><ArrowDownwardIcon fontSize="small" /></IconButton>
                  <Button size="small" sx={secondaryButtonSx} onClick={() => setOpen(b.slug)} data-testid={`admin-variant-button-open-${b.slug}`}>{t('admin.variants.edit')}</Button>
                  <IconButton size="small" onClick={() => setRemoving(b)} aria-label={t('admin.variants.remove')} data-testid={`admin-variant-button-remove-${b.slug}`}><DeleteOutlineIcon fontSize="small" /></IconButton>
                </Box>
              ) : null}
            </Box>
          ))}
        </Box>
      ))}
      {!buttons.length && list.data ? <Box sx={{ ...typo.body, color: ink.mid }}>{t(`${k}.none`)}</Box> : null}
      {canWrite ? (
        <Box>
          <Button sx={primaryButtonSx} onClick={() => setAdding(true)} data-testid="admin-variant-button-add">{t(`${k}.add`)}</Button>
        </Box>
      ) : null}
      <Err error={order.error} />
      {adding ? <AddButtonDialog hotelId={hotelId} code={code} zones={zones} onClose={() => setAdding(false)} onAdded={(slug) => { setAdding(false); setOpen(slug); }} /> : null}
      {open && buttons.find((b) => b.slug === open) ? <ButtonDialog hotelId={hotelId} code={code} zones={zones} button={buttons.find((b) => b.slug === open)!} onClose={() => setOpen(null)} /> : null}
      {removing ? (
        <AdminDialog
          title={t(`${k}.removeTitle`, { name: buttonLabel(t, removing, i18n.language) })}
          onClose={() => setRemoving(null)}
          testId="admin-variant-button-remove-dialog"
          actions={
            <>
              <Button sx={secondaryButtonSx} onClick={() => setRemoving(null)}>{t('admin.variants.cancel')}</Button>
              <Button sx={{ ...primaryButtonSx, bgcolor: state.bad, '&:hover': { bgcolor: state.bad } }} disabled={remove.isPending} onClick={() => remove.mutate(removing.slug)} data-testid="admin-variant-button-remove-confirm">{t('admin.variants.remove')}</Button>
            </>
          }
        >
          <Box sx={{ ...typo.body, color: ink.hi }}>{t(`${k}.removeAbout`)}</Box>
          <Err error={remove.error} />
        </AdminDialog>
      ) : null}
    </Box>
  );
}

function ZoneSelect({ zones, value, onChange, testId }: { zones: Array<{ code: string; title: Record<string, string> }>; value: string; onChange: (v: string) => void; testId: string }) {
  const { t, i18n } = useTranslation();
  return (
    <SelectField
      label={t('admin.variants.buttons.zone')}
      value={value || '__none__'}
      onChange={(v) => onChange(v === '__none__' ? '' : v)}
      options={[...zones.map((z) => ({ value: z.code, label: pick(z.title, i18n.language) || t('admin.variants.plan.zoneUnnamed') })), { value: '__none__', label: t('admin.variants.buttons.noZone') }]}
      testId={testId}
      fieldSx={fieldSx}
    />
  );
}

function AddButtonDialog({ hotelId, code, zones, onClose, onAdded }: { hotelId: string; code: string; zones: Array<{ code: string; title: Record<string, string> }>; onClose: () => void; onAdded: (slug: string) => void }) {
  const { t } = useTranslation();
  const refresh = useVariantRefresh(hotelId, code);
  const [kind, setKind] = useState<string>('light_group');
  const [zone, setZone] = useState(zones[0]?.code ?? '');
  const [title, setTitle] = useState<Record<string, string>>({});
  const add = useMutation({
    mutationFn: () => addButton(hotelId, code, { kind, zone, title }),
    onSuccess: (r) => {
      refresh();
      onAdded(r.slug);
    },
  });
  const k = 'admin.variants.buttons';
  return (
    <AdminDialog
      title={t(`${k}.addTitle`)}
      onClose={onClose}
      testId="admin-variant-button-add-dialog"
      maxWidth="md"
      actions={
        <>
          <Button sx={secondaryButtonSx} onClick={onClose}>{t('admin.variants.cancel')}</Button>
          <Button sx={primaryButtonSx} disabled={add.isPending} onClick={() => add.mutate()} data-testid="admin-variant-button-add-save">{t(`${k}.addNext`)}</Button>
        </>
      }
    >
      <Box sx={{ display: 'grid', gap: 2 }}>
        <Box>
          <Label text={t(`${k}.kindLabel`)} help={t(`${k}.kindHelp`)} />
          <Chips value={kind as 'scene'} onChange={setKind} testId="admin-variant-kind" options={KINDS.map((x) => [x, t(`admin.variants.kind.${x}`)])} />
        </Box>
        <ZoneSelect zones={zones} value={zone} onChange={setZone} testId="admin-variant-button-zone" />
        <Box>
          <Label text={t(`${k}.guestTitle`)} help={t(`${k}.guestTitleHelp`)} />
          <TitleFields value={title} onChange={setTitle} testId="admin-variant-button-title" placeholder={t(`admin.variants.kind.${kind}`)} />
        </Box>
        <Err error={add.error} />
      </Box>
    </AdminDialog>
  );
}

function ButtonDialog({ hotelId, code, zones, button, onClose }: { hotelId: string; code: string; zones: Array<{ code: string; title: Record<string, string> }>; button: VariantButton; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const refresh = useVariantRefresh(hotelId, code);
  const [title, setTitle] = useState<Record<string, string>>({ ...button.title });
  const [zone, setZone] = useState(button.zone);
  const [picking, setPicking] = useState<string | null>(null);
  const save = useMutation({ mutationFn: () => updateButton(hotelId, code, button.slug, { title, zone }), onSuccess: refresh });
  const unlink = useMutation({ mutationFn: (cap: string) => unlinkChannel(hotelId, code, button.slug, cap), onSuccess: refresh });
  const k = 'admin.variants.buttons';
  const dirty = JSON.stringify(title) !== JSON.stringify(button.title) || zone !== button.zone;
  return (
    <AdminDialog
      title={buttonLabel(t, button, i18n.language)}
      subtitle={t(`admin.variants.kind.${button.kind}`, { defaultValue: t('admin.variants.kind.other') })}
      onClose={onClose}
      testId="admin-variant-button-dialog"
      maxWidth="md"
      actions={<Button sx={primaryButtonSx} onClick={onClose} data-testid="admin-variant-button-done">{t('admin.variants.done')}</Button>}
    >
      <Box sx={{ display: 'grid', gap: 2 }}>
        <Box>
          <Label text={t(`${k}.guestTitle`)} help={t(`${k}.guestTitleHelp`)} />
          <TitleFields value={title} onChange={setTitle} testId="admin-variant-button-title" placeholder={t(`admin.variants.kind.${button.kind}`)} />
        </Box>
        <ZoneSelect zones={zones} value={zone} onChange={setZone} testId="admin-variant-button-zone" />
        {dirty ? (
          <Box>
            <Button size="small" sx={secondaryButtonSx} disabled={save.isPending} onClick={() => save.mutate()} data-testid="admin-variant-button-save">{t('admin.variants.save')}</Button>
          </Box>
        ) : null}
        <Box>
          <Label text={t(`${k}.links`)} help={t(`${k}.linksHelp`)} />
          <Box sx={{ display: 'grid', gap: 0.75 }}>
            {button.abilities.map((a) => (
              <Box key={a.capability} sx={{ p: 1, borderRadius: `${shape.radiusSmall}px`, border: `1px solid ${a.sense || a.form ? state.warn : !a.variable && a.required ? state.bad : surface.line}` }} data-testid={`admin-variant-ability-${a.capability}`} data-linked={a.variable ? 'true' : 'false'}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Box sx={{ flex: 1, minWidth: 160 }}>
                    <Box sx={{ ...typo.body, fontWeight: 700, color: ink.hi }}>
                      {t(`admin.variants.ability.${a.capability}`, { defaultValue: a.capability })}
                      {a.required ? <Box component="span" sx={{ ...typo.caption, color: ink.mid, fontWeight: 400 }}> · {t(`${k}.required`)}</Box> : <Box component="span" sx={{ ...typo.caption, color: ink.mid, fontWeight: 400 }}> · {t(`${k}.optional`)}</Box>}
                    </Box>
                    <Box sx={{ ...typo.caption, color: a.variable ? ink.mid : a.required ? state.bad : ink.low }}>
                      {a.variable ? <span data-words="data">{[a.command, a.feedback].filter(Boolean).join(' / ')}</span> : t(a.required ? `${k}.notLinkedRequired` : `${k}.notLinked`)}
                    </Box>
                    {a.sense ? <Box sx={{ ...typo.caption, color: state.warn }}>{t(`${k}.sense`, { expected: t(`admin.variants.subject.${a.sense.expected}`), found: t(`admin.variants.subject.${a.sense.found}`) })}</Box> : null}
                  </Box>
                  <Button size="small" sx={secondaryButtonSx} onClick={() => setPicking(a.capability)} data-testid={`admin-variant-pick-${a.capability}`}>{t(a.variable ? `${k}.change` : `${k}.pick`)}</Button>
                  {a.variable ? <Button size="small" sx={quietButtonSx} disabled={unlink.isPending} onClick={() => unlink.mutate(a.capability)} data-testid={`admin-variant-unlink-${a.capability}`}>{t(`${k}.unlink`)}</Button> : null}
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
        <Err error={save.error || unlink.error} />
        {picking ? <ChannelPicker hotelId={hotelId} code={code} button={button} capability={picking} onClose={() => setPicking(null)} /> : null}
      </Box>
    </AdminDialog>
  );
}

function ChannelPicker({ hotelId, code, button, capability, onClose }: { hotelId: string; code: string; button: VariantButton; capability: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const refresh = useVariantRefresh(hotelId, code);
  const words = useErrorWords();
  const list = useQuery({ queryKey: ['admin', 'variant-channels', hotelId, code, button.slug, capability], queryFn: () => getChannels(hotelId, code, button.slug, capability) });
  const [warn, setWarn] = useState<ChannelOption | null>(null);
  const link = useMutation({
    mutationFn: ({ key, accept }: { key: string; accept: boolean }) => linkChannel(hotelId, code, button.slug, { capability, variable: key, accept_warning: accept }),
    onSuccess: () => {
      refresh();
      onClose();
    },
    onError: (e, vars) => {
      // Проверка смысла: сервер не связал — спросить явно, а не молча.
      if (e instanceof PlatformError && e.code === 'binding_sense_warning') setWarn(list.data?.channels.find((c) => c.key === vars.key) ?? null);
    },
  });
  const k = 'admin.variants.channels';
  const fitTone = { good: 'ok', ok: 'info', warn: 'warn', bad: 'muted' } as const;
  return (
    <AdminDialog
      title={t(`${k}.title`, { ability: t(`admin.variants.ability.${capability}`, { defaultValue: capability }), button: buttonLabel(t, button, i18n.language) })}
      subtitle={t(`${k}.subtitle`)}
      onClose={onClose}
      testId="admin-variant-channel-picker"
      maxWidth="md"
      actions={<Button sx={secondaryButtonSx} onClick={onClose}>{t('admin.variants.cancel')}</Button>}
    >
      <Box sx={{ display: 'grid', gap: 0.5 }}>
        {(list.data?.channels ?? []).map((c) => (
          <ButtonBase
            key={c.key}
            disabled={c.fit === 'bad' || link.isPending}
            onClick={() => link.mutate({ key: c.key, accept: false })}
            data-testid={`admin-variant-channel-${c.key}`}
            data-fit={c.fit}
            sx={{ justifyContent: 'flex-start', textAlign: 'start', gap: 1.5, p: 1, borderRadius: `${shape.radiusSmall}px`, border: `1px solid ${surface.line}`, opacity: c.fit === 'bad' ? 0.55 : 1, '&:hover': { borderColor: accent.main } }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ ...typo.body, fontWeight: 700, color: ink.hi }} data-words="data">{[c.command, c.feedback].filter(Boolean).join(' / ') || c.key}</Box>
              <Box sx={{ ...typo.caption, color: ink.mid }}>
                {t(`${k}.range`, { min: c.range[0], max: c.range[1] })}
                {c.taken_by ? (
                  <>
                    {' · '}
                    {t(`${k}.taken`)} <span data-words="data">«{c.taken_by}»</span>
                  </>
                ) : null}
              </Box>
              {c.sense ? <Box sx={{ ...typo.caption, color: state.warn }}>{t(`${k}.senseShort`, { found: t(`admin.variants.subject.${c.sense.found}`) })}</Box> : null}
              {c.form ? <Box sx={{ ...typo.caption, color: ink.mid }} data-words="data">{c.form}</Box> : null}
            </Box>
            <Pill tone={fitTone[c.fit]}>{t(`${k}.fit.${c.fit}`)}</Pill>
          </ButtonBase>
        ))}
        {list.data && !list.data.channels.length ? <Box sx={{ ...typo.body, color: ink.mid }}>{t(`${k}.none`)}</Box> : null}
        {link.error && !(link.error instanceof PlatformError && link.error.code === 'binding_sense_warning') ? <Typography sx={{ ...typo.caption, color: state.bad }}>{words(link.error)}</Typography> : null}
      </Box>
      {warn ? (
        <AdminDialog
          title={t(`${k}.warnTitle`)}
          onClose={() => setWarn(null)}
          testId="admin-variant-sense-dialog"
          actions={
            <>
              <Button sx={secondaryButtonSx} onClick={() => setWarn(null)} data-testid="admin-variant-sense-cancel">{t(`${k}.warnPickOther`)}</Button>
              <Button sx={{ ...primaryButtonSx, bgcolor: state.warn, '&:hover': { bgcolor: state.warn } }} onClick={() => link.mutate({ key: warn.key, accept: true })} data-testid="admin-variant-sense-accept">{t(`${k}.warnAccept`)}</Button>
            </>
          }
        >
          <Box sx={{ ...typo.body, color: ink.hi }} data-testid="admin-variant-sense-text">
            {t(`${k}.warnText`, {
              button: t(`admin.variants.subject.${warn.sense?.expected ?? 'light'}`),
              found: t(`admin.variants.subject.${warn.sense?.found ?? 'light'}`),
            })}
          </Box>
        </AdminDialog>
      ) : null}
    </AdminDialog>
  );
}

/* ── Проверка: тестовая команда с подтверждением ───────────────────────────── */

export function TestCommand({ hotelId, code, rooms }: { hotelId: string; code: string; rooms: Array<{ id: string; number: string }> }) {
  const { t, i18n } = useTranslation();
  const words = useErrorWords();
  const list = useButtons(hotelId, code);
  const ready = (list.data?.buttons ?? []).filter((b) => b.abilities.some((a) => a.variable && a.capability !== 'current_temp'));
  const [room, setRoom] = useState('');
  const [slug, setSlug] = useState('');
  const [cap, setCap] = useState('');
  const [value, setValue] = useState<number>(1);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const button = ready.find((b) => b.slug === slug) ?? ready[0];
  const abilities = (button?.abilities ?? []).filter((a) => a.variable && a.capability !== 'current_temp');
  const ability = abilities.find((a) => a.capability === cap) ?? abilities[0];
  const number = room || rooms[0]?.number || '';
  const binary = ability && ['toggle', 'trigger'].includes(ability.capability);
  const send = useMutation({
    mutationFn: () =>
      testCommand(hotelId, code, {
        element: button!.slug,
        room_number: number,
        capability: ability!.capability,
        value,
        confirm: { room: number, element: button!.slug, value },
      }),
    onSuccess: (r) => {
      setResult(r);
      setConfirming(false);
    },
  });
  const k = 'admin.variants.test';
  const valueWord = binary ? t(`${k}.value.${ability?.capability === 'trigger' ? 'run' : value ? 'on' : 'off'}`) : String(value);
  if (!ready.length || !rooms.length) return <Box sx={{ ...typo.caption, color: ink.mid }}>{t(`${k}.nothing`)}</Box>;
  return (
    <Box sx={{ display: 'grid', gap: 1.25, p: 1.5, borderRadius: `${shape.radiusSmall}px`, border: `1px dashed ${state.warn}` }} data-testid="admin-variant-test">
      <Label text={t(`${k}.title`)} help={t(`${k}.help`)} />
      <Box sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: { xs: '1fr', sm: 'repeat(4, minmax(0, 1fr))' }, alignItems: 'end' }}>
        <SelectField label={t('admin.card.rooms.col.number')} value={number} onChange={setRoom} options={rooms.map((r) => ({ value: r.number, label: r.number }))} testId="admin-variant-test-room" fieldSx={fieldSx} />
        <SelectField label={t(`${k}.button`)} value={button?.slug ?? ''} onChange={(v) => { setSlug(v); setCap(''); setValue(1); }} options={ready.map((b) => ({ value: b.slug, label: buttonLabel(t, b, i18n.language) }))} testId="admin-variant-test-button" fieldSx={fieldSx} />
        <SelectField label={t(`${k}.ability`)} value={ability?.capability ?? ''} onChange={(v) => { setCap(v); setValue(1); }} options={abilities.map((a) => ({ value: a.capability, label: t(`admin.variants.ability.${a.capability}`, { defaultValue: a.capability }) }))} testId="admin-variant-test-ability" fieldSx={fieldSx} />
        {binary ? (
          ability?.capability === 'trigger' ? (
            <Box sx={{ ...typo.body, color: ink.hi }}>{t(`${k}.value.run`)}</Box>
          ) : (
            <Chips value={String(value) as '1'} onChange={(v) => setValue(Number(v))} testId="admin-variant-test-value" options={[['1', t(`${k}.value.on`)], ['0', t(`${k}.value.off`)]]} />
          )
        ) : (
          <TextField size="small" label={t(`${k}.number`)} value={value} onChange={(e) => setValue(Number(e.target.value.replace(/[^\d-]/g, '')) || 0)} sx={fieldSx} inputProps={{ inputMode: 'numeric', 'data-testid': 'admin-variant-test-number' }} />
        )}
      </Box>
      <Box>
        <Button sx={{ ...secondaryButtonSx, borderColor: state.warn, color: state.warn }} onClick={() => setConfirming(true)} data-testid="admin-variant-test-open">{t(`${k}.send`)}</Button>
      </Box>
      {result ? (
        <Box sx={{ ...typo.body, color: result.outcome === 'confirmed' ? state.ok : result.outcome === 'failed' ? state.bad : state.warn }} data-testid="admin-variant-test-result" data-outcome={result.outcome}>
          <b>{t(`${k}.outcome.${result.outcome}`, { defaultValue: t(`${k}.outcome.other`) })}</b>
        </Box>
      ) : null}
      {confirming && button && ability ? (
        <AdminDialog
          title={t(`${k}.confirmTitle`)}
          onClose={() => setConfirming(false)}
          testId="admin-variant-test-confirm"
          actions={
            <>
              <Button sx={secondaryButtonSx} onClick={() => setConfirming(false)}>{t('admin.variants.cancel')}</Button>
              <Button sx={{ ...primaryButtonSx, bgcolor: state.warn, '&:hover': { bgcolor: state.warn } }} disabled={send.isPending} onClick={() => send.mutate()} data-testid="admin-variant-test-send">{t(`${k}.confirmSend`)}</Button>
            </>
          }
        >
          <Box sx={{ display: 'grid', gap: 1, ...typo.body, color: ink.hi }}>
            <Box data-testid="admin-variant-test-summary">
              {t(`${k}.confirmRoom`)} <b data-words="data">{number}</b> · <b data-words="data">{buttonLabel(t, button, i18n.language)}</b> · {t(`admin.variants.ability.${ability.capability}`, { defaultValue: ability.capability })}: <b>{valueWord}</b>
            </Box>
            <Box sx={{ ...typo.caption, color: state.warn }}>{t(`${k}.confirmWarn`)}</Box>
            {send.error ? <Typography sx={{ ...typo.caption, color: state.bad }}>{words(send.error)}</Typography> : null}
          </Box>
        </AdminDialog>
      ) : null}
    </Box>
  );
}

/* ── Публикация и откат ────────────────────────────────────────────────────── */

export function PublishButton({ hotelId, v, diff, roomNumbers, changes }: { hotelId: string; v: VariantCard; diff: VariantDiff | undefined; roomNumbers: string[]; changes: ReactNode }) {
  const { t } = useTranslation();
  const refresh = useVariantRefresh(hotelId, v.code);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const publish = useMutation({
    mutationFn: () => publishVariant(hotelId, v.code, diff!.rooms),
    onSuccess: (r) => {
      setDone(r.version);
      setOpen(false);
      refresh();
    },
    onError: (e) => {
      if (e instanceof PlatformError && e.code === 'publish_rooms_changed') refresh();
    },
  });
  const k = 'admin.variants.publish';
  const nothing = !diff || diff.same || !v.publishable;
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button sx={primaryButtonSx} disabled={nothing} onClick={() => setOpen(true)} data-testid="admin-variant-publish">{t(`${k}.button`)}</Button>
        {!v.publishable ? <Box sx={{ ...typo.caption, color: state.warn }}>{t(`${k}.noButtons`)}</Box> : null}
        {done ? <Box sx={{ ...typo.body, color: state.ok }} data-testid="admin-variant-published">{t(`${k}.done`, { version: done })}</Box> : null}
      </Box>
      {open && diff ? (
        <AdminDialog
          title={t(`${k}.confirmTitle`)}
          onClose={() => setOpen(false)}
          testId="admin-variant-publish-confirm"
          maxWidth="md"
          actions={
            <>
              <Button sx={secondaryButtonSx} onClick={() => setOpen(false)}>{t('admin.variants.cancel')}</Button>
              <Button sx={primaryButtonSx} disabled={publish.isPending} onClick={() => publish.mutate()} data-testid="admin-variant-publish-go">{t(`${k}.go`, { count: diff.rooms })}</Button>
            </>
          }
        >
          <Box sx={{ display: 'grid', gap: 1.25, ...typo.body, color: ink.hi }}>
            <Box sx={{ fontWeight: 700 }} data-testid="admin-variant-publish-rooms">{t(`${k}.willChange`, { count: diff.rooms })}</Box>
            {roomNumbers.length ? <Box sx={{ ...typo.caption, color: ink.mid }} data-words="data">{roomNumbers.join(', ')}</Box> : null}
            <Box>{changes}</Box>
            <Err error={publish.error} />
          </Box>
        </AdminDialog>
      ) : null}
    </Box>
  );
}

export function RollbackButton({ hotelId, code, version, rooms }: { hotelId: string; code: string; version: number; rooms: number }) {
  const { t } = useTranslation();
  const refresh = useVariantRefresh(hotelId, code);
  const [open, setOpen] = useState(false);
  const back = useMutation({ mutationFn: () => rollbackVariant(hotelId, code, version), onSuccess: () => { setOpen(false); refresh(); } });
  const k = 'admin.variants.rollback';
  return (
    <>
      <Button size="small" sx={quietButtonSx} onClick={() => setOpen(true)} data-testid={`admin-variant-rollback-${version}`}>{t(`${k}.button`)}</Button>
      {open ? (
        <AdminDialog
          title={t(`${k}.title`, { version })}
          onClose={() => setOpen(false)}
          testId="admin-variant-rollback-confirm"
          actions={
            <>
              <Button sx={secondaryButtonSx} onClick={() => setOpen(false)}>{t('admin.variants.cancel')}</Button>
              <Button sx={primaryButtonSx} disabled={back.isPending} onClick={() => back.mutate()} data-testid="admin-variant-rollback-go">{t(`${k}.go`)}</Button>
            </>
          }
        >
          <Box sx={{ ...typo.body, color: ink.hi, display: 'grid', gap: 1 }}>
            <Box>{t(`${k}.about`, { version, count: rooms })}</Box>
            <Err error={back.error} />
          </Box>
        </AdminDialog>
      ) : null}
    </>
  );
}

/** Сколько кнопок в каждой зоне — для списка зон. */
export function useZoneCounts(hotelId: string, code: string) {
  const list = useButtons(hotelId, code);
  return useMemo(() => {
    const out: Record<string, number> = {};
    for (const b of list.data?.buttons ?? []) out[b.zone] = (out[b.zone] ?? 0) + 1;
    return out;
  }, [list.data]);
}
