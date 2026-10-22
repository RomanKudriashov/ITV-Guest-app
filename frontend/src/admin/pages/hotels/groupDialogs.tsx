import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Checkbox from '@mui/material/Checkbox';
import Radio from '@mui/material/Radio';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { SearchField } from '@/components/SearchField';
import { useActionFailed } from '@/hooks/useActionFailed';
import { accent, fieldSx, ink, primaryButtonSx, shape, state, surface, typo } from '../../adminTokens';
import { AdminDialog } from '../../form';
import {
  GROUP_COLORS,
  addGroupMembers,
  createGroup,
  deleteGroup,
  getModulesCatalog,
  moveHotels,
  patchGroup,
  previewGroupAction,
  runGroupAction,
  type GroupActionKind,
  type GroupColor,
  type HotelGroup,
  type HotelViewRow,
} from '../../adminClient';
import { GroupMark, Hl } from './hotelsUi';

/**
 * ОКНА ГРУПП (партия 62-A1). Каждое говорит, что будет: отель состоит не
 * больше чем в одной группе, перенос уводит его из прежней; удаление группы
 * отели не трогает.
 */

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'groups'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'fleet'] });
  };
}

export function ColorPicker({ value, onChange }: { value: GroupColor; onChange: (c: GroupColor) => void }) {
  const { t } = useTranslation();
  return (
    <Box role="radiogroup" aria-label={t('admin.hotels.group.color')} sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
      {GROUP_COLORS.map((c) => (
        <ButtonBase
          key={c}
          role="radio"
          aria-checked={value === c}
          data-testid={`admin-group-color-${c}`}
          onClick={() => onChange(c)}
          sx={{
            gap: 0.75,
            px: 1,
            py: 0.5,
            borderRadius: `${shape.pill}px`,
            border: `1px solid ${value === c ? accent.main : surface.line}`,
            bgcolor: value === c ? accent.washSoft : 'transparent',
            ...typo.caption,
            color: ink.hi,
          }}
        >
          <GroupMark color={c} />
          {t(`admin.hotels.color.${c}`)}
        </ButtonBase>
      ))}
    </Box>
  );
}

/** Выбор отелей: поиск, галочки; у отеля из другой группы — «переедет из». */
export function HotelPicker({ rows, selfId, value, onChange }: { rows: HotelViewRow[]; selfId?: string; value: string[]; onChange: (v: string[]) => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const ql = q.toLowerCase();
  const candidates = rows.filter(
    (r) => r.group?.id !== selfId && (!ql || `${r.name} ${r.subdomain} ${r.city}`.toLowerCase().includes(ql)),
  );
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((s) => s !== id) : [...value, id]);
  return (
    <Box>
      <SearchField value={q} onChange={setQ} placeholder={t('admin.hotels.picker.search')} testId="admin-group-picker-search" sx={[fieldSx, { width: '100%' }]} />
      <Box sx={{ mt: 1, maxHeight: 280, overflowY: 'auto', border: `1px solid ${surface.line}`, borderRadius: `${shape.radius}px` }}>
        {!candidates.length ? <Box sx={{ p: 2, ...typo.caption, color: ink.mid }}>{t('admin.hotels.picker.none')}</Box> : null}
        {candidates.map((r) => {
          const on = value.includes(r.id);
          return (
            <ButtonBase
              key={r.id}
              onClick={() => toggle(r.id)}
              data-testid={`admin-group-pick-${r.subdomain}`}
              sx={{ display: 'flex', width: '100%', justifyContent: 'flex-start', gap: 1, px: 1, py: 0.75, textAlign: 'left', borderBottom: `1px solid ${surface.hair}`, bgcolor: on ? accent.washSoft : undefined }}
            >
              <Checkbox size="small" checked={on} tabIndex={-1} sx={{ p: 0.5 }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ ...typo.body, fontWeight: 700, color: r.is_active ? ink.hi : ink.low }}><Hl text={r.name} q={q} /></Box>
                <Box sx={{ ...typo.caption, color: ink.mid }}>
                  <Hl text={r.subdomain} q={q} />
                  {' · '}
                  {r.group ? t('admin.hotels.picker.inGroup', { title: r.group.title }) : t('admin.hotels.ungrouped.short')}
                </Box>
                {on && r.group ? (
                  <Box sx={{ ...typo.caption, color: state.warn, fontWeight: 600 }}>{t('admin.hotels.picker.willMove', { title: r.group.title })}</Box>
                ) : null}
              </Box>
            </ButtonBase>
          );
        })}
      </Box>
      <Typography sx={{ ...typo.caption, color: ink.mid, mt: 0.75 }}>{t('admin.hotels.picker.picked', { count: value.length })}</Typography>
    </Box>
  );
}

export function CreateGroupDialog({ rows, onClose }: { rows: HotelViewRow[]; onClose: () => void }) {
  const { t } = useTranslation();
  const invalidate = useInvalidate();
  const actionFailed = useActionFailed();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState<GroupColor>('accent');
  const [hotels, setHotels] = useState<string[]>([]);
  const create = useMutation({
    mutationFn: () => createGroup({ title: title.trim(), description, color, hotel_ids: hotels }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: actionFailed,
  });
  return (
    <AdminDialog
      testId="admin-group-create"
      title={t('admin.hotels.create.title')}
      subtitle={t('admin.hotels.create.subtitle')}
      onClose={onClose}
      maxWidth="md"
      actions={
        <>
          <Button sx={{ color: ink.mid }} onClick={onClose}>{t('admin.hotels.cancel')}</Button>
          <Button sx={primaryButtonSx} disabled={!title.trim() || create.isPending} onClick={() => create.mutate()} data-testid="admin-group-create-submit">
            {hotels.length ? t('admin.hotels.create.submitWith', { count: hotels.length }) : t('admin.hotels.create.submit')}
          </Button>
        </>
      }
    >
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
        <Box sx={{ display: 'grid', gap: 2, alignContent: 'start' }}>
          <TextField
            label={t('admin.hotels.group.name')}
            required
            placeholder={t('admin.hotels.group.namePlaceholder')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            sx={fieldSx}
            inputProps={{ 'data-testid': 'admin-group-title' }}
          />
          <TextField
            label={t('admin.hotels.group.description')}
            placeholder={t('admin.hotels.group.descriptionPlaceholder')}
            multiline
            minRows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            sx={fieldSx}
          />
          <Box>
            <Typography sx={{ ...typo.caption, color: ink.mid, mb: 0.75 }}>{t('admin.hotels.group.colorHint')}</Typography>
            <ColorPicker value={color} onChange={setColor} />
          </Box>
        </Box>
        <Box>
          <Typography sx={{ ...typo.caption, color: ink.mid, mb: 0.75 }}>{t('admin.hotels.create.hotelsHint')}</Typography>
          <HotelPicker rows={rows} value={hotels} onChange={setHotels} />
        </Box>
      </Box>
    </AdminDialog>
  );
}

export function EditGroupDialog({ group, onClose }: { group: HotelGroup; onClose: () => void }) {
  const { t } = useTranslation();
  const invalidate = useInvalidate();
  const actionFailed = useActionFailed();
  const [title, setTitle] = useState(group.title);
  const [description, setDescription] = useState(group.description);
  const [note, setNote] = useState(group.note);
  const [color, setColor] = useState<GroupColor>(group.color);
  const save = useMutation({
    mutationFn: () => patchGroup(group.id, { title: title.trim(), description, note, color }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: actionFailed,
  });
  return (
    <AdminDialog
      testId="admin-group-edit"
      title={t('admin.hotels.edit.title')}
      subtitle={t('admin.hotels.edit.subtitle')}
      onClose={onClose}
      actions={
        <>
          <Button sx={{ color: ink.mid }} onClick={onClose}>{t('admin.hotels.cancel')}</Button>
          <Button sx={primaryButtonSx} disabled={!title.trim() || save.isPending} onClick={() => save.mutate()} data-testid="admin-group-edit-submit">
            {t('admin.hotels.save')}
          </Button>
        </>
      }
    >
      <Box sx={{ display: 'grid', gap: 2 }}>
        <TextField label={t('admin.hotels.group.name')} required value={title} onChange={(e) => setTitle(e.target.value)} sx={fieldSx} inputProps={{ 'data-testid': 'admin-group-edit-title' }} />
        <TextField label={t('admin.hotels.group.description')} multiline minRows={2} value={description} onChange={(e) => setDescription(e.target.value)} sx={fieldSx} />
        <TextField label={t('admin.hotels.group.note')} helperText={t('admin.hotels.group.noteHint')} multiline minRows={2} value={note} onChange={(e) => setNote(e.target.value)} sx={fieldSx} />
        <Box>
          <Typography sx={{ ...typo.caption, color: ink.mid, mb: 0.75 }}>{t('admin.hotels.group.colorHint')}</Typography>
          <ColorPicker value={color} onChange={setColor} />
        </Box>
      </Box>
    </AdminDialog>
  );
}

export function DeleteGroupDialog({ group, rows, onClose, onDeleted }: { group: HotelGroup; rows: HotelViewRow[]; onClose: () => void; onDeleted?: () => void }) {
  const { t } = useTranslation();
  const invalidate = useInvalidate();
  const actionFailed = useActionFailed();
  const [confirm, setConfirm] = useState('');
  const hotels = rows.filter((r) => r.group?.id === group.id);
  const remove = useMutation({
    mutationFn: () => deleteGroup(group.id, confirm.trim()),
    onSuccess: () => {
      invalidate();
      if (onDeleted) onDeleted();
      else onClose();
    },
    onError: actionFailed,
  });
  return (
    <AdminDialog
      testId="admin-group-delete"
      title={t('admin.hotels.delete.title', { title: group.title })}
      subtitle={t('admin.hotels.delete.subtitle')}
      onClose={onClose}
      actions={
        <>
          <Button sx={{ color: ink.mid }} onClick={onClose}>{t('admin.hotels.cancel')}</Button>
          <Button
            sx={{ ...primaryButtonSx, bgcolor: state.bad }}
            disabled={confirm.trim() !== group.title || remove.isPending}
            onClick={() => remove.mutate()}
            data-testid="admin-group-delete-submit"
          >
            {t('admin.hotels.delete.submit')}
          </Button>
        </>
      }
    >
      <Typography sx={{ ...typo.label, color: ink.mid, mb: 1 }}>
        {hotels.length ? t('admin.hotels.delete.released', { count: hotels.length }) : t('admin.hotels.delete.emptyGroup')}
      </Typography>
      {hotels.map((r) => (
        <Box key={r.id} sx={{ ...typo.body, color: ink.hi, py: 0.4 }}>• {r.name}</Box>
      ))}
      <TextField
        size="small"
        fullWidth
        label={t('admin.hotels.delete.confirm')}
        helperText={t('admin.hotels.delete.confirmHint')}
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        sx={{ ...fieldSx, mt: 2 }}
        inputProps={{ 'data-testid': 'admin-group-delete-confirm' }}
      />
    </AdminDialog>
  );
}

export function MoveDialog({ hotelIds, groups, onClose, onDone }: { hotelIds: string[]; groups: HotelGroup[]; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const invalidate = useInvalidate();
  const actionFailed = useActionFailed();
  const [target, setTarget] = useState<string>(groups[0]?.id ?? 'none');
  const move = useMutation({
    mutationFn: () => moveHotels(hotelIds, target === 'none' ? null : target),
    onSuccess: () => {
      invalidate();
      onDone();
    },
    onError: actionFailed,
  });
  const choices = [
    ...groups.map((g) => ({ id: g.id, title: g.title, color: g.color as GroupColor | null })),
    { id: 'none', title: t('admin.hotels.ungrouped.title'), color: null },
  ];
  return (
    <AdminDialog
      testId="admin-group-move"
      title={t('admin.hotels.move.title', { count: hotelIds.length })}
      subtitle={t('admin.hotels.move.subtitle')}
      onClose={onClose}
      actions={
        <>
          <Button sx={{ color: ink.mid }} onClick={onClose}>{t('admin.hotels.cancel')}</Button>
          <Button sx={primaryButtonSx} disabled={move.isPending} onClick={() => move.mutate()} data-testid="admin-group-move-submit">
            {t('admin.hotels.move.submit')}
          </Button>
        </>
      }
    >
      {choices.map((g) => (
        <ButtonBase
          key={g.id}
          onClick={() => setTarget(g.id)}
          data-testid={`admin-group-move-to-${g.id}`}
          sx={{ display: 'flex', width: '100%', justifyContent: 'flex-start', gap: 1, py: 0.5, borderRadius: `${shape.radius}px`, textAlign: 'left' }}
        >
          <Radio size="small" checked={target === g.id} tabIndex={-1} />
          {g.color ? <GroupMark color={g.color} /> : null}
          <Box sx={{ ...typo.body, fontWeight: 700, color: ink.hi }}>{g.title}</Box>
        </ButtonBase>
      ))}
    </AdminDialog>
  );
}

/**
 * Модули, которые можно включать сейчас, — из реестра сервера (партия 62-E1):
 * своего списка у экрана нет, иначе он разошёлся бы с тем, что сервер
 * разрешает. Остальные — в разработке.
 */
export function useReadyModules(): string[] {
  const catalog = useQuery({ queryKey: ['admin', 'modules-catalog'], queryFn: getModulesCatalog });
  return (catalog.data?.items ?? []).filter((m) => m.status === 'ready').map((m) => m.code);
}

export function AddHotelsDialog({ group, rows, onClose }: { group: HotelGroup; rows: HotelViewRow[]; onClose: () => void }) {
  const { t } = useTranslation();
  const invalidate = useInvalidate();
  const actionFailed = useActionFailed();
  const [hotels, setHotels] = useState<string[]>([]);
  const movers = rows.filter((r) => hotels.includes(r.id) && r.group && r.group.id !== group.id);
  const add = useMutation({
    mutationFn: () => addGroupMembers(group.id, hotels),
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: actionFailed,
  });
  const rule = group.auto_enabled && group.auto_modules.length
    ? t('admin.groupPage.add.ruleOn', { modules: group.auto_modules.map((c) => t(`admin.module.${c}`)).join(', ') })
    : t('admin.groupPage.add.ruleOff');
  return (
    <AdminDialog
      testId="admin-group-add"
      title={t('admin.groupPage.add.title', { title: group.title })}
      subtitle={rule}
      onClose={onClose}
      actions={
        <>
          <Button sx={{ color: ink.mid }} onClick={onClose}>{t('admin.hotels.cancel')}</Button>
          <Button sx={primaryButtonSx} disabled={!hotels.length || add.isPending} onClick={() => add.mutate()} data-testid="admin-group-add-submit">
            {t('admin.groupPage.add.submit', { count: hotels.length })}
          </Button>
        </>
      }
    >
      <HotelPicker rows={rows} selfId={group.id} value={hotels} onChange={setHotels} />
      {movers.length ? (
        <Box sx={{ mt: 1.5, p: 1.25, borderRadius: `${shape.radius}px`, bgcolor: 'var(--adm-state-warn-wash)', ...typo.caption, color: ink.hi }} data-testid="admin-group-add-movers">
          {t('admin.groupPage.add.movers', { count: movers.length })}
        </Box>
      ) : null}
    </AdminDialog>
  );
}

/**
 * Действие по всей группе: сначала показ «что изменится» по каждому отелю
 * (сервер, тем же кодом, что выполнит), потом выполнение ровно показанного.
 */
export function GroupActionDialog({ group, kind: initial, onClose }: { group: HotelGroup; kind: 'module' | 'disable' | 'enable'; onClose: () => void }) {
  const { t } = useTranslation();
  const invalidate = useInvalidate();
  const actionFailed = useActionFailed();
  const ready = useReadyModules();
  const [picked, setModule] = useState('');
  const module = picked || ready[0] || '';
  const [turnOn, setTurnOn] = useState(true);
  const [reason, setReason] = useState('');
  const kind: GroupActionKind = initial === 'module' ? (turnOn ? 'module_on' : 'module_off') : initial;
  const preview = useQuery({
    queryKey: ['admin', 'groups', group.id, 'preview', kind, module],
    queryFn: () => previewGroupAction(group.id, kind, kind.startsWith('module') ? module : undefined),
    // Модуль выбирается из каталога сервера — пока он не пришёл, спрашивать нечего.
    enabled: !kind.startsWith('module') || Boolean(module),
  });
  const plan = preview.data?.items ?? [];
  const changes = plan.filter((r) => r.change);
  const run = useMutation({
    mutationFn: () =>
      runGroupAction(group.id, {
        kind,
        module: kind.startsWith('module') ? module : undefined,
        hotel_ids: changes.map((r) => r.hotel_id),
        reason,
      }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: actionFailed,
  });
  const note = (r: (typeof plan)[number]) =>
    !r.change ? t('admin.groupPage.action.same') : t(`admin.groupPage.action.will.${kind}`);
  const needReason = kind === 'disable';
  return (
    <AdminDialog
      testId={`admin-group-action-${initial}`}
      title={t(`admin.groupPage.action.title.${initial}`, { title: group.title })}
      subtitle={t(`admin.groupPage.action.subtitle.${initial}`)}
      onClose={onClose}
      actions={
        <>
          <Button sx={{ color: ink.mid }} onClick={onClose}>{t('admin.hotels.cancel')}</Button>
          <Button
            sx={kind === 'disable' ? { ...primaryButtonSx, bgcolor: state.bad } : primaryButtonSx}
            disabled={!changes.length || run.isPending || preview.isFetching || (needReason && !reason.trim())}
            onClick={() => run.mutate()}
            data-testid="admin-group-action-submit"
          >
            {t(`admin.groupPage.action.submit.${kind}`, { count: changes.length })}
          </Button>
        </>
      }
    >
      {initial === 'module' ? (
        <Box sx={{ display: 'grid', gap: 1.5, mb: 2 }}>
          <Box>
            <Typography sx={{ ...typo.caption, color: ink.mid, mb: 0.5 }}>{t('admin.groupPage.action.module')}</Typography>
            {ready.map((code) => (
              <ButtonBase key={code} onClick={() => setModule(code)} data-testid={`admin-group-action-module-${code}`} sx={{ display: 'flex', width: '100%', justifyContent: 'flex-start', gap: 1, py: 0.25, textAlign: 'left' }}>
                <Radio size="small" checked={module === code} tabIndex={-1} />
                <Box sx={{ ...typo.body, fontWeight: 700, color: ink.hi }}>{t(`admin.module.${code}`)}</Box>
              </ButtonBase>
            ))}
            <Typography sx={{ ...typo.caption, color: ink.low, mt: 0.5 }}>{t('admin.groupPage.action.devHidden')}</Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            {[true, false].map((on) => (
              <ButtonBase
                key={String(on)}
                onClick={() => setTurnOn(on)}
                data-testid={`admin-group-action-${on ? 'on' : 'off'}`}
                sx={{ px: 1.5, py: 0.75, borderRadius: `${shape.radius}px`, border: `1px solid ${turnOn === on ? accent.main : surface.line}`, bgcolor: turnOn === on ? accent.washSoft : 'transparent', ...typo.body, fontWeight: 600 }}
              >
                {on ? t('admin.groupPage.action.on') : t('admin.groupPage.action.off')}
              </ButtonBase>
            ))}
          </Box>
        </Box>
      ) : (
        <TextField
          label={t('admin.groupPage.action.reason')}
          required={needReason}
          multiline
          minRows={2}
          fullWidth
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          sx={{ ...fieldSx, mb: 2 }}
          helperText={t('admin.groupPage.action.reasonHint')}
          inputProps={{ 'data-testid': 'admin-group-action-reason' }}
        />
      )}
      <Box sx={{ p: 1.5, borderRadius: `${shape.radius}px`, bgcolor: surface.s2 }} data-testid="admin-group-action-plan">
        <Typography sx={{ ...typo.label, color: ink.mid, mb: 0.75 }}>{t('admin.groupPage.action.plan', { count: plan.length })}</Typography>
        {preview.isPending ? <Box sx={{ ...typo.caption, color: ink.mid }}>{t('admin.groupPage.loading')}</Box> : null}
        {plan.map((r) => (
          <Box key={r.hotel_id} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, py: 0.4, ...typo.caption }} data-testid={`admin-group-plan-${r.subdomain}`}>
            <Box sx={{ color: ink.hi, fontWeight: 600 }}>{r.name}</Box>
            <Box sx={{ color: r.change ? (kind === 'disable' ? state.bad : accent.soft) : ink.low }}>{note(r)}</Box>
          </Box>
        ))}
      </Box>
    </AdminDialog>
  );
}
