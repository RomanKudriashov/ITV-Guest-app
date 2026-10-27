import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import { useTranslation } from 'react-i18next';

import { accent, fieldSx, glassPanel, ink, primaryButtonSx, secondaryButtonSx, shadow, shape, state, surface, typo } from '../../adminTokens';
import {
  PlatformError,
  clearRoomPin,
  createDictItem,
  createRooms,
  deleteDictItem,
  deleteRoom,
  getRoomDetail,
  getRoomHistory,
  patchRoom,
  previewRooms,
  renameDictItem,
  roomDeleteCheck,
  roomRenameCheck,
  setRoomPin,
  type BulkRequest,
  type DictItem,
  type DictKind,
  type RenameImpact,
  type RoomDetail,
  type RoomPatch,
  type RoomsDictionaries,
} from '../../adminClient';
import { AdminDialog } from '../../form';
import { SelectField } from '@/components/SelectField';
import { DateField } from '@/components/DateField';
import { Help, Pill } from '../hotels/hotelsUi';
import { JournalRow } from '../journalUi';

/**
 * ОКНА НОМЕРНОГО ФОНДА В CONTROL (партия 63-1): номер целиком (модалка вместо
 * боковой панели), добавление номеров, корпуса и категории. Всё — через те же
 * сервисы, что у панели отеля; права как в Control: «только чтение» видит
 * окна без кнопок правки.
 */

const errorText = (error: unknown) => (error instanceof PlatformError ? error.message : error instanceof Error ? error.message : String(error));

function invalidateRooms(client: ReturnType<typeof useQueryClient>, hotelId: string) {
  return Promise.all([
    client.invalidateQueries({ queryKey: ['admin', 'hotel-rooms-map', hotelId] }),
    client.invalidateQueries({ queryKey: ['admin', 'rooms-dictionaries', hotelId] }),
    client.invalidateQueries({ queryKey: ['admin', 'room-detail', hotelId] }),
    client.invalidateQueries({ queryKey: ['admin', 'room-history', hotelId] }),
    // Готовность отеля зависит от фонда: обзор и счётчик проблем пересчитываются.
    client.invalidateQueries({ queryKey: ['admin', 'readiness', hotelId] }),
  ]);
}

/** Рамка окна: по центру, на телефоне — во весь экран. */
function Frame({ open = true, onClose, children, testId, wide = false }: { open?: boolean; onClose: () => void; children: ReactNode; testId: string; wide?: boolean }) {
  const phone = useMediaQuery('(max-width:599px)');
  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={phone}
      maxWidth={wide ? 'md' : 'sm'}
      fullWidth
      data-testid={testId}
      slotProps={{
        paper: {
          sx: {
            ...glassPanel('sheet'),
            backgroundImage: 'none',
            borderRadius: phone ? 0 : `${shape.radiusLarge}px`,
            boxShadow: shadow.dialog,
            display: 'flex',
            flexDirection: 'column',
            maxHeight: phone ? '100%' : 'calc(100% - 48px)',
          },
        },
      }}
    >
      {children}
    </Dialog>
  );
}

function Confirm({ title, children, confirm, danger = false, onConfirm, onCancel, busy = false, testId }: {
  title: string;
  children: ReactNode;
  confirm: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  testId: string;
}) {
  const { t } = useTranslation();
  return (
    <AdminDialog
      title={title}
      onClose={onCancel}
      testId={testId}
      maxWidth="xs"
      actions={
        <>
          <Button sx={secondaryButtonSx} onClick={onCancel} data-testid={`${testId}-cancel`}>{t('admin.card.rooms.edit.cancel')}</Button>
          <Button
            sx={{ ...primaryButtonSx, ...(danger ? { bgcolor: state.bad, '&:hover': { bgcolor: state.bad } } : {}) }}
            onClick={onConfirm}
            disabled={busy}
            data-testid={`${testId}-ok`}
          >
            {confirm}
          </Button>
        </>
      }
    >
      <Box sx={{ ...typo.body, color: ink.hi, display: 'grid', gap: 1 }}>{children}</Box>
    </AdminDialog>
  );
}

/* ── Номер целиком ──────────────────────────────────────────────────────── */

type Section = 'main' | 'control' | 'access' | 'state' | 'problems' | 'history';
const SECTIONS: Section[] = ['main', 'control', 'access', 'state', 'problems', 'history'];

interface Form {
  number: string;
  building_id: string;
  floor: string;
  position: string;
  category_id: string;
  variant: string;
  /** Подключение (партия 65): id назначенного; пусто — «по умолчанию». */
  connection: string;
  device_name: string;
  is_active: boolean;
  out_of_service: boolean;
}

function formOf(room: RoomDetail): Form {
  return {
    number: room.number,
    building_id: room.building_id ?? '',
    floor: room.floor,
    position: room.position,
    category_id: room.category_id ?? '',
    variant: room.variant?.code ?? '',
    connection: room.connection?.explicit ? room.connection.id : '',
    device_name: room.device.override,
    is_active: room.is_active,
    out_of_service: room.out_of_service,
  };
}

function diff(before: Form, after: Form): RoomPatch {
  const patch: RoomPatch = {};
  if (before.number !== after.number) patch.number = after.number.trim();
  if (before.building_id !== after.building_id) patch.building_id = after.building_id || null;
  if (before.floor !== after.floor) patch.floor = after.floor.trim();
  if (before.position !== after.position) patch.position = after.position.trim();
  if (before.category_id !== after.category_id) patch.category_id = after.category_id || null;
  if (before.variant !== after.variant) patch.variant = after.variant;
  if (before.connection !== after.connection) patch.connection = after.connection || null;
  if (before.device_name !== after.device_name) patch.device_name = after.device_name.trim();
  if (before.is_active !== after.is_active) patch.is_active = after.is_active;
  if (before.out_of_service !== after.out_of_service) patch.out_of_service = after.out_of_service;
  return patch;
}

export function RoomDialog({
  hotelId,
  roomId,
  order,
  dict,
  canWrite,
  onNavigate,
  onClose,
  onOpenTab,
}: {
  hotelId: string;
  roomId: string;
  /** Порядок номеров на экране — для ← и →. */
  order: string[];
  dict: RoomsDictionaries | undefined;
  canWrite: boolean;
  onNavigate: (roomId: string) => void;
  onClose: () => void;
  onOpenTab: (tab: string) => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [section, setSection] = useState<Section>('main');
  const [form, setForm] = useState<Form | null>(null);
  const [leaving, setLeaving] = useState<null | { kind: 'close' } | { kind: 'go'; id: string }>(null);
  const [rename, setRename] = useState<RenameImpact | null>(null);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const detail = useQuery({ queryKey: ['admin', 'room-detail', hotelId, roomId], queryFn: () => getRoomDetail(hotelId, roomId), placeholderData: keepPreviousData });
  const room = detail.data && detail.data.id === roomId ? detail.data : undefined;
  const base = useMemo(() => (room ? formOf(room) : null), [room]);
  // Новый номер — форма с его значениями; тот же номер после сохранения —
  // форма с сохранёнными (а не старыми) значениями.
  useEffect(() => {
    if (base) setForm(base);
  }, [base]);
  const patch = base && form ? diff(base, form) : {};
  const dirty = Object.keys(patch).length > 0;
  const index = order.indexOf(roomId);
  const prev = index > 0 ? order[index - 1] : null;
  const next = index >= 0 && index < order.length - 1 ? order[index + 1] : null;

  const save = useMutation({
    mutationFn: (body: RoomPatch) => patchRoom(hotelId, roomId, body),
    onSuccess: async () => {
      setError('');
      setRename(null);
      setSaved(true);
      await invalidateRooms(client, hotelId);
    },
    onError: (e) => setError(errorText(e)),
  });

  const attempt = (action: { kind: 'close' } | { kind: 'go'; id: string }) => {
    if (dirty && canWrite) setLeaving(action);
    else if (action.kind === 'close') onClose();
    else go(action.id);
  };
  const go = (id: string) => {
    setSaved(false);
    setError('');
    setRename(null);
    onNavigate(id);
  };

  const submit = async () => {
    if (!base || !form) return;
    setSaved(false);
    if (patch.number !== undefined && patch.number !== base.number) {
      try {
        setRename(await roomRenameCheck(hotelId, roomId, patch.number));
      } catch (e) {
        setError(errorText(e));
      }
      return;
    }
    save.mutate(patch);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, [role="combobox"], [role="listbox"]')) return;
    if (event.key === 'ArrowLeft' && prev) {
      event.preventDefault();
      attempt({ kind: 'go', id: prev });
    }
    if (event.key === 'ArrowRight' && next) {
      event.preventDefault();
      attempt({ kind: 'go', id: next });
    }
  };

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setSaved(false);
    setForm((f) => (f ? { ...f, [key]: value } : f));
  };

  return (
    <Frame onClose={() => attempt({ kind: 'close' })} testId="admin-room-dialog" wide>
      <Box onKeyDown={onKeyDown} sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: { xs: '14px 12px 8px', sm: '18px 20px 8px' } }}>
          <IconButton size="small" onClick={() => prev && attempt({ kind: 'go', id: prev })} disabled={!prev} aria-label={t('admin.card.rooms.edit.prev')} title={t('admin.card.rooms.edit.prevHint')} data-testid="admin-room-prev">
            <ChevronLeftIcon />
          </IconButton>
          <Typography component="h2" sx={{ ...typo.pageTitle, fontSize: 20, color: ink.hi, flex: 1, minWidth: 0 }} data-testid="admin-room-dialog-title">
            {room ? t('admin.card.rooms.card.title', { number: room.number }) : '…'}
          </Typography>
          <IconButton size="small" onClick={() => next && attempt({ kind: 'go', id: next })} disabled={!next} aria-label={t('admin.card.rooms.edit.next')} title={t('admin.card.rooms.edit.nextHint')} data-testid="admin-room-next">
            <ChevronRightIcon />
          </IconButton>
          <IconButton size="small" onClick={() => attempt({ kind: 'close' })} aria-label={t('admin.card.rooms.place.close')} data-testid="admin-room-dialog-close">
            <CloseIcon />
          </IconButton>
        </Box>
        <Box role="tablist" sx={{ display: 'flex', gap: 0.5, px: { xs: 1.5, sm: 2.5 }, overflowX: 'auto', borderBottom: `1px solid ${surface.hair}`, flex: 'none' }}>
          {SECTIONS.map((key) => (
            <ButtonBase
              key={key}
              role="tab"
              aria-selected={section === key}
              onClick={() => setSection(key)}
              data-testid={`admin-room-tab-${key}`}
              sx={{
                ...typo.caption,
                fontWeight: 700,
                px: 1.25,
                py: 1,
                whiteSpace: 'nowrap',
                color: section === key ? accent.soft : ink.mid,
                borderBottom: `2px solid ${section === key ? accent.main : 'transparent'}`,
                gap: 0.5,
              }}
            >
              {t(`admin.card.rooms.edit.section.${key}`)}
              {key === 'problems' && room?.problems.length ? <Pill tone="bad">{room.problems.length}</Pill> : null}
            </ButtonBase>
          ))}
        </Box>
        <Box sx={{ p: { xs: 1.5, sm: 2.5 }, overflowY: 'auto', flex: 1, minHeight: 240 }} data-testid={`admin-room-section-${section}`}>
          {!room || !form ? (
            <Typography sx={{ ...typo.body, color: ink.mid }}>{t('admin.card.rooms.edit.loading')}</Typography>
          ) : section === 'main' ? (
            <MainSection room={room} form={form} set={set} dict={dict} canWrite={canWrite} />
          ) : section === 'control' ? (
            <ControlSection room={room} form={form} set={set} dict={dict} canWrite={canWrite} />
          ) : section === 'access' ? (
            <AccessSection hotelId={hotelId} room={room} canWrite={canWrite} />
          ) : section === 'state' ? (
            <StateSection form={form} set={set} canWrite={canWrite} />
          ) : section === 'problems' ? (
            <ProblemsSection room={room} onFix={(target) => (target.startsWith('tab:') ? onOpenTab(target.slice(4)) : setSection(target as Section))} />
          ) : (
            <HistorySection hotelId={hotelId} roomId={roomId} />
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', p: { xs: '10px 12px 14px', sm: '12px 20px 18px' }, borderTop: `1px solid ${surface.hair}`, flex: 'none' }}>
          {canWrite && room ? (
            <Button sx={{ ...secondaryButtonSx, color: state.bad }} onClick={() => setRemoving(true)} data-testid="admin-room-delete">
              {t('admin.card.rooms.del.button')}
            </Button>
          ) : null}
          <Box sx={{ flex: 1, minWidth: 8, ...typo.caption, color: error ? state.bad : state.ok }} data-testid="admin-room-dialog-status">
            {error || (saved ? t('admin.card.rooms.edit.saved') : '')}
          </Box>
          {canWrite ? (
            <Button sx={primaryButtonSx} onClick={() => void submit()} disabled={!dirty || save.isPending} data-testid="admin-room-save">
              {t('admin.card.rooms.edit.save')}
            </Button>
          ) : null}
        </Box>
      </Box>
      {leaving ? (
        <Confirm
          title={t('admin.card.rooms.edit.leaveTitle')}
          confirm={t('admin.card.rooms.edit.leaveOk')}
          testId="admin-room-leave"
          onCancel={() => setLeaving(null)}
          onConfirm={() => {
            const action = leaving;
            setLeaving(null);
            if (base) setForm(base);
            if (action.kind === 'close') onClose();
            else go(action.id);
          }}
        >
          {t('admin.card.rooms.edit.leaveBody')}
        </Confirm>
      ) : null}
      {rename ? (
        <Confirm
          title={t('admin.card.rooms.edit.renameTitle', { from: rename.number, to: rename.new_number })}
          confirm={t('admin.card.rooms.edit.renameOk')}
          testId="admin-room-rename"
          busy={save.isPending}
          onCancel={() => setRename(null)}
          onConfirm={() => save.mutate({ ...patch, confirm_rename: true })}
        >
          <Box>{t('admin.card.rooms.edit.renameQr')}</Box>
          {rename.device_changes ? <Box>{t('admin.card.rooms.edit.renameDevice', { from: rename.device, to: rename.device_after })}</Box> : null}
          {rename.live_sessions ? <Box>{t('admin.card.rooms.edit.renameSessions', { count: rename.live_sessions })}</Box> : null}
        </Confirm>
      ) : null}
      {removing && room ? (
        <DeleteRoom
          hotelId={hotelId}
          room={room}
          onCancel={() => setRemoving(false)}
          onDone={() => {
            setRemoving(false);
            onClose();
          }}
        />
      ) : null}
    </Frame>
  );
}

function FieldRow({ children }: { children: ReactNode }) {
  return <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, mb: 2 }}>{children}</Box>;
}

function LabelWithHelp({ label, help }: { label: string; help: string }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
      {label}
      <Help>{help}</Help>
    </Box>
  );
}

function MainSection({ room, form, set, dict, canWrite }: { room: RoomDetail; form: Form; set: <K extends keyof Form>(k: K, v: Form[K]) => void; dict?: RoomsDictionaries; canWrite: boolean }) {
  const { t } = useTranslation();
  const none = { value: '', label: t('admin.card.rooms.edit.none') };
  return (
    <Box>
      <FieldRow>
        <TextField size="small" label={t('admin.card.rooms.col.number')} value={form.number} onChange={(e) => set('number', e.target.value.slice(0, 32))} disabled={!canWrite} sx={fieldSx} inputProps={{ 'data-testid': 'admin-room-number' }} helperText={t('admin.card.rooms.edit.numberHelp')} />
        <SelectField
          label={t('admin.card.rooms.col.building')}
          value={form.building_id}
          onChange={(v) => set('building_id', v)}
          options={[none, ...(dict?.buildings ?? []).map((b) => ({ value: b.id, label: b.title_i18n }))]}
          disabled={!canWrite}
          testId="admin-room-building"
          fieldSx={fieldSx}
        />
      </FieldRow>
      <FieldRow>
        <TextField
          size="small"
          label={<LabelWithHelp label={t('admin.card.rooms.col.floor')} help={t('admin.card.rooms.edit.floorHelp')} />}
          value={form.floor}
          onChange={(e) => set('floor', e.target.value.slice(0, 16))}
          placeholder={room.rule_floor ? t('admin.card.rooms.edit.byRule', { value: room.rule_floor }) : ''}
          InputLabelProps={{ shrink: true }}
          disabled={!canWrite}
          sx={fieldSx}
          inputProps={{ 'data-testid': 'admin-room-floor' }}
          helperText={form.floor ? t('admin.card.rooms.edit.floorSet') : room.rule_floor ? t('admin.card.rooms.edit.floorRule', { value: room.rule_floor }) : t('admin.card.rooms.edit.floorNone')}
        />
        <TextField
          size="small"
          label={<LabelWithHelp label={t('admin.card.rooms.col.position')} help={t('admin.card.rooms.place.help')} />}
          value={form.position}
          onChange={(e) => set('position', e.target.value.slice(0, 16))}
          placeholder={room.rule_position ? t('admin.card.rooms.edit.byRule', { value: room.rule_position }) : ''}
          InputLabelProps={{ shrink: true }}
          disabled={!canWrite}
          sx={fieldSx}
          inputProps={{ 'data-testid': 'admin-room-place-input' }}
          helperText={form.position ? t('admin.card.rooms.edit.positionSet') : room.rule_position ? t('admin.card.rooms.place.byRule', { position: room.rule_position }) : t('admin.card.rooms.place.byRuleNone')}
        />
      </FieldRow>
      <FieldRow>
        <SelectField
          label={t('admin.card.rooms.col.category')}
          value={form.category_id}
          onChange={(v) => set('category_id', v)}
          options={[none, ...(dict?.categories ?? []).map((c) => ({ value: c.id, label: c.title_i18n }))]}
          disabled={!canWrite}
          testId="admin-room-category"
          fieldSx={fieldSx}
        />
        <Box sx={{ ...typo.caption, color: ink.mid, alignSelf: 'center' }}>
          {t('admin.card.rooms.edit.guestLink')}{' '}
          <Box component="span" sx={{ color: ink.hi, wordBreak: 'break-all' }} data-words="data">{room.guest_url}</Box>
        </Box>
      </FieldRow>
    </Box>
  );
}

function ControlSection({ room, form, set, dict, canWrite }: { room: RoomDetail; form: Form; set: <K extends keyof Form>(k: K, v: Form[K]) => void; dict?: RoomsDictionaries; canWrite: boolean }) {
  const { t } = useTranslation();
  const template = dict?.variants.find((v) => v.code === form.variant)?.device_template ?? '';
  const byTemplate = template.replace('{room}', form.number);
  const defaultName = dict?.connections.find((c) => c.default)?.name ?? '';
  return (
    <Box>
      {!room.room_control ? <Typography sx={{ ...typo.body, color: ink.mid, mb: 2 }}>{t('admin.card.rooms.fix.moduleOff')}</Typography> : null}
      <FieldRow>
        <SelectField
          label={<LabelWithHelp label={t('admin.card.rooms.col.variant')} help={t('admin.card.rooms.layer.help.variant')} />}
          value={form.variant}
          onChange={(v) => set('variant', v)}
          options={[{ value: '', label: t('admin.card.rooms.edit.noVariant') }, ...(dict?.variants ?? []).map((v) => ({ value: v.code, label: v.title }))]}
          disabled={!canWrite}
          testId="admin-room-variant"
          fieldSx={fieldSx}
          helperText={!dict?.variants.length ? t('admin.card.rooms.edit.noVariants') : undefined}
        />
        <TextField
          size="small"
          label={<LabelWithHelp label={t('admin.card.rooms.edit.device')} help={t('admin.card.rooms.edit.deviceHelp')} />}
          value={form.device_name}
          onChange={(e) => set('device_name', e.target.value.slice(0, 255))}
          placeholder={byTemplate ? t('admin.card.rooms.edit.byTemplate', { value: byTemplate }) : ''}
          InputLabelProps={{ shrink: true }}
          disabled={!canWrite || !form.variant}
          sx={fieldSx}
          inputProps={{ 'data-testid': 'admin-room-device', 'data-words': 'data' }}
          helperText={!form.variant ? t('admin.card.rooms.edit.deviceNeedsVariant') : form.device_name ? t('admin.card.rooms.edit.deviceManual') : t('admin.card.rooms.edit.deviceByTemplate')}
        />
      </FieldRow>
      {/* Подключение (партия 65): через какой сервер управления идёт номер. */}
      {dict?.connections.length ? (
        <FieldRow>
          <SelectField
            label={<LabelWithHelp label={t('admin.card.rooms.col.connection')} help={t('admin.card.rooms.layer.help.connection')} />}
            value={form.connection}
            onChange={(v) => set('connection', v)}
            options={[
              { value: '', label: `${t('admin.card.rooms.batch.connectionByDefault')}${defaultName ? ` (${defaultName})` : ''}` },
              ...dict.connections.map((c) => ({ value: c.id, label: c.default ? `${c.name} · ${t('admin.card.rooms.connectionDefaultShort')}` : c.name })),
            ]}
            disabled={!canWrite}
            testId="admin-room-connection"
            fieldSx={fieldSx}
          />
        </FieldRow>
      ) : null}
    </Box>
  );
}

function StateSection({ form, set, canWrite }: { form: Form; set: <K extends keyof Form>(k: K, v: Form[K]) => void; canWrite: boolean }) {
  const { t } = useTranslation();
  const row = (key: 'is_active' | 'out_of_service', testId: string) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1, borderBottom: `1px solid ${surface.hair}` }}>
      <Box sx={{ flex: 1 }}>
        <Box sx={{ ...typo.body, fontWeight: 700, color: ink.hi, display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {t(`admin.card.rooms.edit.${key}`)}
          <Help>{t(`admin.card.rooms.edit.${key}Help`)}</Help>
        </Box>
        <Box sx={{ ...typo.caption, color: ink.mid }}>{t(`admin.card.rooms.edit.${key}${form[key] ? 'On' : 'Off'}`)}</Box>
      </Box>
      <Switch checked={form[key]} onChange={(e) => set(key, e.target.checked)} disabled={!canWrite} inputProps={{ 'aria-label': t(`admin.card.rooms.edit.${key}`), 'data-testid': testId } as never} />
    </Box>
  );
  return (
    <Box>
      {row('is_active', 'admin-room-active')}
      {row('out_of_service', 'admin-room-out')}
    </Box>
  );
}

function ProblemsSection({ room, onFix }: { room: RoomDetail; onFix: (target: string) => void }) {
  const { t } = useTranslation();
  const target: Record<string, string> = {
    no_link: 'tab:connections',
    no_variant: 'control',
    not_published: 'tab:roomControl',
    no_pin: 'access',
    demo_entry: 'access',
  };
  if (!room.room_control) return <Typography sx={{ ...typo.body, color: ink.mid }}>{t('admin.card.rooms.fix.moduleOff')}</Typography>;
  if (!room.problems.length) return <Typography sx={{ ...typo.body, color: ink.mid }} data-testid="admin-room-problems-none">{t('admin.card.rooms.edit.noProblems')}</Typography>;
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      {room.problems.map((code) => (
        <Box key={code} sx={{ display: 'flex', gap: 1, alignItems: 'center', p: 1.25, borderRadius: `${shape.radiusSmall}px`, border: `1px solid ${surface.hair}` }} data-testid={`admin-room-problem-${code}`}>
          <Box sx={{ flex: 1 }}>
            <Box sx={{ ...typo.body, fontWeight: 700, color: code === 'demo_entry' ? state.warn : state.bad }}>{t(`admin.card.rooms.problem.${code}`)}</Box>
            <Box sx={{ ...typo.caption, color: ink.mid }}>{t(`admin.card.rooms.edit.why.${code}`)}</Box>
          </Box>
          <Button size="small" sx={secondaryButtonSx} onClick={() => onFix(target[code])} data-testid={`admin-room-fix-${code}`}>
            {t('admin.card.rooms.edit.fix')}
          </Button>
        </Box>
      ))}
    </Box>
  );
}

function HistorySection({ hotelId, roomId }: { hotelId: string; roomId: string }) {
  const { t } = useTranslation();
  const history = useQuery({ queryKey: ['admin', 'room-history', hotelId, roomId], queryFn: () => getRoomHistory(hotelId, roomId) });
  if (history.isPending) return <Typography sx={{ ...typo.body, color: ink.mid }}>{t('admin.card.rooms.edit.loading')}</Typography>;
  if (!history.data?.items.length) return <Typography sx={{ ...typo.body, color: ink.mid }} data-testid="admin-room-history-empty">{t('admin.card.rooms.edit.historyEmpty')}</Typography>;
  return (
    <Box sx={{ display: 'grid', gap: 0.5 }} data-testid="admin-room-history">
      {history.data.items.map((entry) => (
        <JournalRow key={entry.id} entry={entry} testId={`admin-room-history-${entry.id}`} />
      ))}
    </Box>
  );
}

/* ── PIN ────────────────────────────────────────────────────────────────── */

function AccessSection({ hotelId, room, canWrite }: { hotelId: string; room: RoomDetail; canWrite: boolean }) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [mode, setMode] = useState<null | 'manual'>(null);
  const [pin, setPin] = useState('');
  const [until, setUntil] = useState('');
  const [shown, setShown] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setShown(null);
    setMode(null);
    setPin('');
    setError('');
  }, [room.id]);
  const done = async () => {
    setError('');
    await invalidateRooms(client, hotelId);
  };
  const issue = useMutation({
    mutationFn: (body: { pin?: string; generate?: boolean; valid_until?: string | null }) => setRoomPin(hotelId, room.id, body),
    onSuccess: async (result) => {
      setShown(result.pin);
      setMode(null);
      setPin('');
      await done();
    },
    onError: (e) => setError(errorText(e)),
  });
  const clear = useMutation({
    mutationFn: () => clearRoomPin(hotelId, room.id),
    onSuccess: async () => {
      setClearing(false);
      setShown(null);
      await done();
    },
    onError: (e) => setError(errorText(e)),
  });
  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(i18n.language) : '');

  if (!room.room_control) return <Typography sx={{ ...typo.body, color: ink.mid }}>{t('admin.card.rooms.fix.moduleOff')}</Typography>;
  return (
    <Box sx={{ display: 'grid', gap: 2 }} data-testid="admin-room-access">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Pill tone={room.pin.has ? 'ok' : 'bad'}>{room.pin.has ? t('admin.card.rooms.pinValue.yes') : t('admin.card.rooms.pinValue.no')}</Pill>
        <Box sx={{ ...typo.caption, color: ink.mid }} data-testid="admin-room-pin-state">
          {room.pin.has
            ? room.pin.valid_until
              ? t('admin.card.rooms.access.until', { date: date(room.pin.valid_until) })
              : t('admin.card.rooms.access.noEnd')
            : room.pin.expired
              ? t('admin.card.rooms.access.expired')
              : room.demo_entry
                ? t('admin.card.rooms.access.demo')
                : t('admin.card.rooms.access.none')}
        </Box>
        <Help>{t('admin.card.rooms.access.help')}</Help>
      </Box>
      {shown ? (
        <Box sx={{ p: 1.5, borderRadius: `${shape.radius}px`, border: `1px solid ${accent.main}`, bgcolor: accent.washSoft, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }} data-testid="admin-room-pin-shown">
          <Box sx={{ fontFamily: 'monospace', fontSize: 26, fontWeight: 800, letterSpacing: 4, color: ink.hi }} data-words="data">{shown}</Box>
          <Button size="small" sx={secondaryButtonSx} startIcon={<ContentCopyOutlinedIcon fontSize="small" />} onClick={() => void navigator.clipboard?.writeText(shown).catch(() => undefined)}>
            {t('admin.card.rooms.access.copy')}
          </Button>
          <Box sx={{ ...typo.caption, color: ink.mid, flexBasis: '100%' }}>{t('admin.card.rooms.access.once')}</Box>
        </Box>
      ) : null}
      {canWrite ? (
        <>
          <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, alignItems: 'start' }}>
            <DateField label={t('admin.card.rooms.access.validUntil')} value={until} onChange={setUntil} testId="admin-room-pin-until" helperText={t('admin.card.rooms.access.validUntilHelp')} />
            {mode === 'manual' ? (
              <TextField
                size="small"
                label={t('admin.card.rooms.access.pin')}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 12))}
                sx={fieldSx}
                type="password"
                autoComplete="new-password"
                inputProps={{ inputMode: 'numeric', 'data-testid': 'admin-room-pin-input' }}
                helperText={t('admin.card.rooms.access.pinHelp')}
              />
            ) : null}
          </Box>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button sx={primaryButtonSx} disabled={issue.isPending} onClick={() => issue.mutate({ generate: true, valid_until: until || null })} data-testid="admin-room-pin-generate">
              {t('admin.card.rooms.access.generate')}
            </Button>
            {mode === 'manual' ? (
              <Button sx={secondaryButtonSx} disabled={issue.isPending || pin.length < 4} onClick={() => issue.mutate({ pin, valid_until: until || null })} data-testid="admin-room-pin-save">
                {t('admin.card.rooms.access.saveManual')}
              </Button>
            ) : (
              <Button sx={secondaryButtonSx} onClick={() => setMode('manual')} data-testid="admin-room-pin-manual">
                {t('admin.card.rooms.access.manual')}
              </Button>
            )}
            {room.pin.has || room.pin.expired ? (
              <Button sx={{ ...secondaryButtonSx, color: state.bad }} onClick={() => setClearing(true)} data-testid="admin-room-pin-clear">
                {t('admin.card.rooms.access.clear')}
              </Button>
            ) : null}
          </Box>
        </>
      ) : null}
      {error ? <Typography sx={{ ...typo.caption, color: state.bad }}>{error}</Typography> : null}
      {clearing ? (
        <Confirm
          title={t('admin.card.rooms.access.clearTitle', { number: room.number })}
          confirm={t('admin.card.rooms.access.clear')}
          danger
          busy={clear.isPending}
          testId="admin-room-pin-clear-confirm"
          onCancel={() => setClearing(false)}
          onConfirm={() => clear.mutate()}
        >
          {t('admin.card.rooms.access.clearBody')}
        </Confirm>
      ) : null}
    </Box>
  );
}

/* ── Удаление номера ────────────────────────────────────────────────────── */

function DeleteRoom({ hotelId, room, onCancel, onDone }: { hotelId: string; room: RoomDetail; onCancel: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const impact = useQuery({ queryKey: ['admin', 'room-delete-check', hotelId, room.id], queryFn: () => roomDeleteCheck(hotelId, room.id) });
  const remove = useMutation({
    mutationFn: () => deleteRoom(hotelId, room.id),
    onSuccess: async () => {
      await invalidateRooms(client, hotelId);
      onDone();
    },
  });
  const data = impact.data;
  return (
    <Confirm
      title={t('admin.card.rooms.del.title', { number: room.number })}
      confirm={t('admin.card.rooms.del.ok')}
      danger
      busy={remove.isPending || !data}
      testId="admin-room-delete-confirm"
      onCancel={onCancel}
      onConfirm={() => remove.mutate()}
    >
      <Box>{t('admin.card.rooms.del.lead')}</Box>
      <Box component="ul" sx={{ m: 0, pl: 2.5, display: 'grid', gap: 0.5 }} data-testid="admin-room-delete-impact">
        <li>{data?.pin ? t('admin.card.rooms.del.pin') : t('admin.card.rooms.del.noPin')}</li>
        <li>{data?.sessions ? t('admin.card.rooms.del.sessions', { count: data.sessions }) : t('admin.card.rooms.del.noSessions')}</li>
        <li>{data?.variant ? t('admin.card.rooms.del.variant', { variant: data.variant }) : t('admin.card.rooms.del.noVariant')}</li>
        <li>{t('admin.card.rooms.del.history')}</li>
      </Box>
      {remove.isError ? <Box sx={{ color: state.bad }}>{errorText(remove.error)}</Box> : null}
    </Confirm>
  );
}

/* ── Добавление номеров ─────────────────────────────────────────────────── */

export function AddRoomsDialog({
  hotelId,
  dict,
  initial,
  onClose,
}: {
  hotelId: string;
  dict: RoomsDictionaries | undefined;
  initial: { building_id?: string; floor?: string; spec?: string };
  onClose: (created?: number) => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [spec, setSpec] = useState(initial.spec ?? '');
  const [building, setBuilding] = useState(initial.building_id ?? '');
  const [floor, setFloor] = useState(initial.floor ?? '');
  const [category, setCategory] = useState('');
  const [restore, setRestore] = useState(true);
  const [debounced, setDebounced] = useState(spec);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(spec), 350);
    return () => window.clearTimeout(id);
  }, [spec]);
  const body: BulkRequest = { spec: debounced.trim(), floor: floor.trim(), building_id: building || null, category_id: category || null, restore };
  const preview = useQuery({
    queryKey: ['admin', 'rooms-preview', hotelId, debounced.trim()],
    queryFn: () => previewRooms(hotelId, { spec: debounced.trim() }),
    enabled: Boolean(debounced.trim()),
    retry: false,
  });
  const create = useMutation({
    mutationFn: () => createRooms(hotelId, { ...body, spec: spec.trim() }),
    onSuccess: async (result) => {
      await invalidateRooms(client, hotelId);
      onClose(result.created_count);
    },
  });
  const p = preview.data;
  const none = { value: '', label: t('admin.card.rooms.edit.none') };
  const list = (numbers: string[]) => (numbers.length > 24 ? `${numbers.slice(0, 24).join(', ')}…` : numbers.join(', '));
  const count = p ? p.create_count : 0;
  return (
    <AdminDialog
      title={t('admin.card.rooms.add.title')}
      subtitle={t('admin.card.rooms.add.subtitle')}
      onClose={() => onClose()}
      testId="admin-rooms-add-dialog"
      actions={
        <>
          <Button sx={secondaryButtonSx} onClick={() => onClose()}>{t('admin.card.rooms.edit.cancel')}</Button>
          <Button sx={primaryButtonSx} disabled={!count || create.isPending || preview.isFetching || debounced !== spec} onClick={() => create.mutate()} data-testid="admin-rooms-add-submit">
            {count ? t('admin.card.rooms.add.submit', { count }) : t('admin.card.rooms.add.submitNone')}
          </Button>
        </>
      }
    >
      <Box sx={{ display: 'grid', gap: 2 }}>
        <TextField
          size="small"
          autoFocus
          label={<LabelWithHelp label={t('admin.card.rooms.add.spec')} help={t('admin.card.rooms.add.specHelp')} />}
          value={spec}
          onChange={(e) => setSpec(e.target.value.slice(0, 4000))}
          placeholder={t('admin.card.rooms.add.example')}
          InputLabelProps={{ shrink: true }}
          sx={fieldSx}
          inputProps={{ 'data-testid': 'admin-rooms-add-spec' }}
          helperText={t('admin.card.rooms.add.limit')}
        />
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' } }}>
          <SelectField label={t('admin.card.rooms.col.building')} value={building} onChange={setBuilding} options={[none, ...(dict?.buildings ?? []).map((b) => ({ value: b.id, label: b.title_i18n }))]} testId="admin-rooms-add-building" fieldSx={fieldSx} />
          <TextField size="small" label={t('admin.card.rooms.col.floor')} value={floor} onChange={(e) => setFloor(e.target.value.slice(0, 16))} sx={fieldSx} inputProps={{ 'data-testid': 'admin-rooms-add-floor' }} helperText={t('admin.card.rooms.add.floorHelp')} />
          <SelectField label={t('admin.card.rooms.col.category')} value={category} onChange={setCategory} options={[none, ...(dict?.categories ?? []).map((c) => ({ value: c.id, label: c.title_i18n }))]} testId="admin-rooms-add-category" fieldSx={fieldSx} />
        </Box>
        <Box sx={{ p: 1.5, borderRadius: `${shape.radius}px`, bgcolor: surface.s2, ...typo.body, color: ink.hi, display: 'grid', gap: 0.75, minHeight: 64 }} data-testid="admin-rooms-add-preview">
          {!debounced.trim() ? (
            <Box sx={{ color: ink.mid }}>{t('admin.card.rooms.add.previewEmpty')}</Box>
          ) : preview.isError ? (
            <Box sx={{ color: state.bad }} data-testid="admin-rooms-add-error">{errorText(preview.error)}</Box>
          ) : p ? (
            <>
              <Box data-testid="admin-rooms-add-will">
                <b>{t('admin.card.rooms.add.will', { count: p.create_count })}</b> {p.will_create.length ? <span data-words="data">{list(p.will_create)}</span> : null}
              </Box>
              {p.exists.length ? (
                <Box sx={{ color: state.warn }} data-testid="admin-rooms-add-exists">
                  {t('admin.card.rooms.add.exists', { count: p.exists_count })} <span data-words="data">{list(p.exists)}</span>
                </Box>
              ) : null}
              {p.will_restore.length ? (
                <Box sx={{ display: 'grid', gap: 0.5 }} data-testid="admin-rooms-add-buried">
                  <Box sx={{ color: state.warn }}>
                    {t('admin.card.rooms.add.buried', { count: p.will_restore.length })} <span data-words="data">{list(p.will_restore)}</span>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                    {([true, false] as const).map((value) => (
                      <ButtonBase
                        key={String(value)}
                        onClick={() => setRestore(value)}
                        aria-pressed={restore === value}
                        data-testid={`admin-rooms-add-restore-${value ? 'yes' : 'no'}`}
                        sx={{ px: 1.25, py: 0.5, borderRadius: `${shape.pill}px`, ...typo.caption, fontWeight: 700, border: `1px solid ${restore === value ? accent.main : surface.line}`, color: restore === value ? accent.soft : ink.mid, bgcolor: restore === value ? accent.washSoft : 'transparent' }}
                      >
                        {t(value ? 'admin.card.rooms.add.restore' : 'admin.card.rooms.add.fresh')}
                      </ButtonBase>
                    ))}
                  </Box>
                  <Box sx={{ ...typo.caption, color: ink.mid }}>{t(restore ? 'admin.card.rooms.add.restoreHelp' : 'admin.card.rooms.add.freshHelp')}</Box>
                </Box>
              ) : null}
            </>
          ) : (
            <Box sx={{ color: ink.mid }}>{t('admin.card.rooms.edit.loading')}</Box>
          )}
        </Box>
        {create.isError ? <Typography sx={{ ...typo.caption, color: state.bad }}>{errorText(create.error)}</Typography> : null}
      </Box>
    </AdminDialog>
  );
}

/* ── Корпуса и категории ────────────────────────────────────────────────── */

export function DictionaryDialog({
  hotelId,
  kind,
  dict,
  canWrite,
  onClose,
}: {
  hotelId: string;
  kind: DictKind;
  dict: RoomsDictionaries | undefined;
  canWrite: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const items = (kind === 'building' ? dict?.buildings : dict?.categories) ?? [];
  const languages = dict?.languages ?? [{ code: 'ru', title: '', is_default: true }];
  const [editing, setEditing] = useState<string | 'new' | null>(items.length ? null : 'new');
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState<DictItem | null>(null);
  const [moveTo, setMoveTo] = useState('');
  const [error, setError] = useState('');
  const firstField = useRef<HTMLInputElement | null>(null);
  const k = `admin.card.rooms.dict.${kind}`;

  const startEdit = (item: DictItem | null) => {
    setError('');
    setEditing(item ? item.id : 'new');
    setTitles(Object.fromEntries(languages.map((l) => [l.code, item?.title?.[l.code] ?? ''])));
    window.setTimeout(() => firstField.current?.focus(), 0);
  };
  const save = useMutation({
    mutationFn: () => {
      const clean = Object.fromEntries(Object.entries(titles).map(([code, value]) => [code, value.trim()]).filter(([, value]) => value));
      return editing === 'new' ? createDictItem(hotelId, kind, clean) : renameDictItem(hotelId, kind, editing as string, clean);
    },
    onSuccess: async () => {
      setEditing(null);
      await invalidateRooms(client, hotelId);
    },
    onError: (e) => setError(errorText(e)),
  });
  const remove = useMutation({
    mutationFn: (item: DictItem) => deleteDictItem(hotelId, kind, item.id, item.rooms_count ? moveTo || 'none' : undefined),
    onSuccess: async () => {
      setRemoving(null);
      setMoveTo('');
      await invalidateRooms(client, hotelId);
    },
    onError: (e) => setError(errorText(e)),
  });

  const editor = (
    <Box sx={{ display: 'grid', gap: 1.25, p: 1.5, borderRadius: `${shape.radius}px`, border: `1px solid ${accent.main}`, bgcolor: accent.washSoft }} data-testid={`admin-dict-editor`}>
      {languages.map((lang, i) => (
        <TextField
          key={lang.code}
          size="small"
          inputRef={i === 0 ? firstField : undefined}
          label={t(`${k}.titleIn`, { language: lang.title || lang.code })}
          value={titles[lang.code] ?? ''}
          onChange={(e) => setTitles({ ...titles, [lang.code]: e.target.value.slice(0, 64) })}
          sx={fieldSx}
          inputProps={{ 'data-testid': `admin-dict-title-${lang.code}` }}
        />
      ))}
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button size="small" sx={primaryButtonSx} disabled={save.isPending || !Object.values(titles).some((v) => v.trim())} onClick={() => save.mutate()} data-testid="admin-dict-save">
          {t('admin.card.rooms.edit.save')}
        </Button>
        <Button size="small" sx={secondaryButtonSx} onClick={() => setEditing(null)}>{t('admin.card.rooms.edit.cancel')}</Button>
      </Box>
    </Box>
  );

  return (
    <AdminDialog
      title={t(`${k}.title`)}
      subtitle={t(`${k}.subtitle`)}
      onClose={onClose}
      testId={`admin-dict-${kind}`}
      actions={
        <>
          {canWrite && editing === null ? (
            <Button sx={secondaryButtonSx} onClick={() => startEdit(null)} data-testid="admin-dict-add">
              {t(`${k}.add`)}
            </Button>
          ) : null}
          <Button sx={primaryButtonSx} onClick={onClose}>{t('admin.card.rooms.place.close')}</Button>
        </>
      }
    >
      <Box sx={{ display: 'grid', gap: 1 }}>
        {editing === 'new' ? editor : null}
        {!items.length && editing !== 'new' ? <Typography sx={{ ...typo.body, color: ink.mid }}>{t(`${k}.empty`)}</Typography> : null}
        {items.map((item) =>
          editing === item.id ? (
            <Box key={item.id}>{editor}</Box>
          ) : (
            <Box key={item.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.75, borderBottom: `1px solid ${surface.hair}` }} data-testid={`admin-dict-item-${item.code}`}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ ...typo.body, fontWeight: 700, color: ink.hi }} data-words="data">{item.title_i18n}</Box>
                <Box sx={{ ...typo.caption, color: ink.mid }}>
                  {t('admin.card.rooms.roomsCount', { count: item.rooms_count })}
                  {languages.length > 1
                    ? ` · ${languages.map((l) => `${l.title || l.code}: ${item.title?.[l.code] || '—'}`).join(' · ')}`
                    : ''}
                </Box>
              </Box>
              {canWrite ? (
                <>
                  <Button size="small" sx={secondaryButtonSx} onClick={() => startEdit(item)} data-testid={`admin-dict-rename-${item.code}`}>
                    {t(`${k}.rename`)}
                  </Button>
                  <Button size="small" sx={{ ...secondaryButtonSx, color: state.bad }} onClick={() => setRemoving(item)} data-testid={`admin-dict-delete-${item.code}`}>
                    {t(`${k}.delete`)}
                  </Button>
                </>
              ) : null}
            </Box>
          ),
        )}
        {error ? <Typography sx={{ ...typo.caption, color: state.bad }}>{error}</Typography> : null}
      </Box>
      {removing ? (
        <Confirm
          title={t(`${k}.deleteTitle`, { name: removing.title_i18n })}
          confirm={t(`${k}.delete`)}
          danger
          busy={remove.isPending}
          testId="admin-dict-delete-confirm"
          onCancel={() => setRemoving(null)}
          onConfirm={() => remove.mutate(removing)}
        >
          {removing.rooms_count ? (
            <>
              <Box>{t(`${k}.busy`, { count: removing.rooms_count })}</Box>
              <SelectField
                label={t(`${k}.moveTo`)}
                value={moveTo}
                onChange={setMoveTo}
                options={[{ value: '', label: t(`${k}.moveNone`) }, ...items.filter((i) => i.id !== removing.id).map((i) => ({ value: i.id, label: i.title_i18n }))]}
                testId="admin-dict-move-to"
                fieldSx={fieldSx}
              />
            </>
          ) : (
            <Box>{t(`${k}.free`)}</Box>
          )}
        </Confirm>
      ) : null}
    </AdminDialog>
  );
}
