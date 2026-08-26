import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { useTranslation } from 'react-i18next';

import { QueryState } from '@/components/QueryState';
import { ink, panelSx, typo } from '../adminTokens';
import {
  addGroupMembers,
  createGroup,
  deleteGroup,
  getFleet,
  getGroupMembers,
  getGroups,
  removeGroupMember,
  type HotelGroup,
} from '../adminClient';

/**
 * ГРУППЫ ОТЕЛЕЙ — адрес для массовых действий платформы.
 *
 * Экран отвечает на три вопроса: какие группы есть, кто в каждой и откуда он
 * там взялся.
 *
 * ДВА ВИДА РАЗЛИЧАЮТСЯ НА ЭКРАНЕ, а не в голове у оператора. У списка состав
 * сложен руками, и напротив каждого отеля написано, кто и когда его добавил. У
 * правила состава нет вовсе — есть условие, и он вычисляется в момент, когда о
 * нём спросили; авторов там быть не может, и вместо выдуманных мы честно пишем
 * «по правилу».
 *
 * РАЗМЕР СЧИТАЕТ СЕРВЕР. Соблазн посчитать строки на клиенте велик и неверен:
 * у правила строк членства нет, и экран показал бы ноль там, где отелей сорок.
 */
export function GroupsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [openGroup, setOpenGroup] = useState<HotelGroup | null>(null);
  const [creating, setCreating] = useState(false);

  const groups = useQuery({ queryKey: ['admin', 'groups'], queryFn: getGroups });

  return (
    <Box data-testid="admin-groups">
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Box>
          <Typography sx={typo.pageTitle}>{t('admin.groups.title')}</Typography>
          <Typography sx={{ ...typo.caption, color: ink.low }}>
            {t('admin.groups.subtitle')}
          </Typography>
        </Box>
        <Button variant="contained" onClick={() => setCreating(true)} data-testid="admin-group-add">
          {t('admin.groups.add')}
        </Button>
      </Stack>

      <QueryState query={groups} what={t('admin.groups.title')}>
        {(data) =>
          data.items.length === 0 ? (
            <Box sx={{ ...panelSx, p: 3 }} data-testid="admin-groups-empty">
              <Typography sx={{ color: ink.low }}>{t('admin.groups.empty')}</Typography>
            </Box>
          ) : (
            <Box sx={{ ...panelSx, overflow: 'hidden' }}>
              <Table size="small" data-testid="admin-groups-table">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('admin.groups.name')}</TableCell>
                    <TableCell>{t('admin.groups.kind')}</TableCell>
                    <TableCell>{t('admin.groups.mode')}</TableCell>
                    <TableCell align="right">{t('admin.groups.size')}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.items.map((group) => (
                    <TableRow key={group.id} hover data-testid={`admin-group-${group.code}`}>
                      <TableCell>
                        <Button
                          size="small"
                          onClick={() => setOpenGroup(group)}
                          data-testid={`admin-group-open-${group.code}`}
                        >
                          {group.title}
                        </Button>
                      </TableCell>
                      <TableCell>{t(`admin.groups.kinds.${group.kind}`, group.kind)}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          variant="outlined"
                          label={t(`admin.groups.modes.${group.mode}`)}
                          data-testid={`admin-group-mode-${group.code}`}
                        />
                        {group.mode === 'rule' ? (
                          <Typography sx={{ ...typo.caption, color: ink.low, mt: 0.5 }}>
                            {Object.entries(group.rule)
                              .map(([key, value]) => `${t(`admin.groups.ruleFields.${key}`, key)}: ${value}`)
                              .join(' · ')}
                          </Typography>
                        ) : null}
                      </TableCell>
                      <TableCell align="right">{group.size ?? '—'}</TableCell>
                      <TableCell align="right">
                        <IconButton
                          size="small"
                          onClick={() => {
                            void deleteGroup(group.id).then(() =>
                              queryClient.invalidateQueries({ queryKey: ['admin', 'groups'] }),
                            );
                          }}
                          aria-label={t('common.delete')}
                          data-testid={`admin-group-delete-${group.code}`}
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )
        }
      </QueryState>

      {openGroup ? <MembersDialog group={openGroup} onClose={() => setOpenGroup(null)} /> : null}
      {creating ? <CreateDialog onClose={() => setCreating(false)} /> : null}
    </Box>
  );
}

/* ── Состав ─────────────────────────────────────────────────────────────── */

function MembersDialog({ group, onClose }: { group: HotelGroup; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');

  const members = useQuery({
    queryKey: ['admin', 'groups', group.id, 'members'],
    queryFn: () => getGroupMembers(group.id),
  });

  // Кандидаты на добавление ищутся во флоте: список руками — это выбор из
  // живых отелей, а не ввод идентификаторов.
  const candidates = useQuery({
    queryKey: ['admin', 'groups', 'candidates', search],
    queryFn: () => getFleet({ search, page_size: 10 }),
    enabled: group.mode === 'list' && search.trim().length > 1,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'groups'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'groups', group.id, 'members'] });
  };

  const addMutation = useMutation({
    mutationFn: (hotelId: string) => addGroupMembers(group.id, [hotelId]),
    onSuccess: refresh,
  });
  const removeMutation = useMutation({
    mutationFn: (hotelId: string) => removeGroupMember(group.id, hotelId),
    onSuccess: refresh,
  });

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth data-testid="admin-group-members">
      <DialogTitle>
        {group.title}
        <Typography sx={{ ...typo.caption, color: ink.low }}>
          {group.mode === 'rule'
            ? t('admin.groups.ruleComposition')
            : t('admin.groups.listComposition')}
        </Typography>
      </DialogTitle>
      <DialogContent>
        {group.mode === 'list' ? (
          <Stack spacing={1} sx={{ mb: 2 }}>
            <TextField
              size="small"
              label={t('admin.groups.addHotel')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              inputProps={{ 'data-testid': 'admin-group-member-search' }}
            />
            {(candidates.data?.items ?? []).map((row) => (
              <Button
                key={row.id}
                size="small"
                sx={{ justifyContent: 'flex-start' }}
                onClick={() => addMutation.mutate(row.id)}
                data-testid={`admin-group-add-${row.subdomain}`}
              >
                {row.name} · {row.subdomain}
              </Button>
            ))}
          </Stack>
        ) : null}

        <QueryState query={members} what={t('admin.groups.title')}>
          {(data) => (
            <Table size="small" data-testid="admin-group-members-table">
              <TableHead>
                <TableRow>
                  <TableCell>{t('admin.groups.hotel')}</TableCell>
                  <TableCell>{t('admin.groups.addedBy')}</TableCell>
                  <TableCell>{t('admin.groups.addedAt')}</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {data.members.map((member) => (
                  <TableRow key={member.hotel_id} data-testid={`admin-group-member-${member.subdomain}`}>
                    <TableCell>
                      {member.name}
                      <Typography sx={{ ...typo.caption, color: ink.low }}>
                        {member.subdomain}
                      </Typography>
                    </TableCell>
                    {/*
                      У правила автора нет и быть не может: отель попал в группу
                      условием. Пишем это словами, а не оставляем пустое место —
                      пустое читается как «данные не доехали».
                    */}
                    <TableCell>{member.added_by ?? t('admin.groups.byRule')}</TableCell>
                    <TableCell>
                      {member.added_at ? new Date(member.added_at).toLocaleString() : '—'}
                    </TableCell>
                    <TableCell align="right">
                      {group.mode === 'list' ? (
                        <IconButton
                          size="small"
                          onClick={() => removeMutation.mutate(member.hotel_id)}
                          aria-label={t('common.delete')}
                          data-testid={`admin-group-remove-${member.subdomain}`}
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </QueryState>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  );
}

/* ── Создание ───────────────────────────────────────────────────────────── */

function CreateDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    code: '',
    title: '',
    kind: 'network',
    mode: 'list' as 'list' | 'rule',
    city: '',
    origin: '',
  });

  const save = useMutation({
    mutationFn: () =>
      createGroup({
        code: form.code.trim(),
        title: form.title.trim(),
        kind: form.kind,
        mode: form.mode,
        rule:
          form.mode === 'rule'
            ? { ...(form.city ? { city: form.city } : {}), ...(form.origin ? { origin: form.origin } : {}) }
            : {},
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'groups'] });
      onClose();
    },
  });

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth data-testid="admin-group-dialog">
      <DialogTitle>{t('admin.groups.add')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            size="small"
            label={t('admin.groups.name')}
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
            inputProps={{ 'data-testid': 'admin-group-title' }}
          />
          <TextField
            size="small"
            label={t('admin.groups.code')}
            value={form.code}
            onChange={(event) => setForm({ ...form, code: event.target.value })}
            inputProps={{ 'data-testid': 'admin-group-code' }}
          />
          <TextField
            select
            size="small"
            label={t('admin.groups.kind')}
            value={form.kind}
            onChange={(event) => setForm({ ...form, kind: event.target.value })}
            SelectProps={{ SelectDisplayProps: { 'data-testid': 'admin-group-kind' } as never }}
          >
            {['network', 'brand', 'city', 'test', 'campaign', 'custom'].map((kind) => (
              <MenuItem key={kind} value={kind}>
                {t(`admin.groups.kinds.${kind}`)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label={t('admin.groups.mode')}
            value={form.mode}
            onChange={(event) => setForm({ ...form, mode: event.target.value as 'list' | 'rule' })}
            SelectProps={{ SelectDisplayProps: { 'data-testid': 'admin-group-mode' } as never }}
            helperText={t(`admin.groups.modeHint.${form.mode}`)}
          >
            <MenuItem value="list">{t('admin.groups.modes.list')}</MenuItem>
            <MenuItem value="rule">{t('admin.groups.modes.rule')}</MenuItem>
          </TextField>

          {form.mode === 'rule' ? (
            <>
              <TextField
                size="small"
                label={t('admin.groups.ruleFields.city')}
                value={form.city}
                onChange={(event) => setForm({ ...form, city: event.target.value })}
                inputProps={{ 'data-testid': 'admin-group-rule-city' }}
              />
              <TextField
                select
                size="small"
                label={t('admin.groups.ruleFields.origin')}
                value={form.origin}
                onChange={(event) => setForm({ ...form, origin: event.target.value })}
                SelectProps={{ SelectDisplayProps: { 'data-testid': 'admin-group-rule-origin' } as never }}
              >
                <MenuItem value="">{t('admin.groups.any')}</MenuItem>
                <MenuItem value="live">{t('admin.groups.originLive')}</MenuItem>
                <MenuItem value="demo">{t('admin.groups.originDemo')}</MenuItem>
              </TextField>
            </>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          disabled={!form.title.trim() || !form.code.trim() || save.isPending}
          onClick={() => save.mutate()}
          data-testid="admin-group-save"
        >
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
