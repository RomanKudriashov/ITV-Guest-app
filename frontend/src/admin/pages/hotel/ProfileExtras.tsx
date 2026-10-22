import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { SortBar, sortRows, useSort, type SortColumn } from '../../sort';

import { SelectField } from '@/components/SelectField';
import { useActionFailed } from '@/hooks/useActionFailed';
import { ink, panelSx, pillSx, primaryButtonSx, secondaryButtonSx, shape, state, surface, typo } from '../../adminTokens';
import {
  checkDomain,
  getGroups,
  getMe,
  moveHotels,
  patchHotel,
  PlatformError,
  removeAlias,
  type HotelPatch,
  type HotelProfile,
  type NeedsConfirmation,
} from '../../adminClient';
import { GroupMark, Help } from '../hotels/hotelsUi';
import { ConfirmChangesDialog } from './hotelDialogs';

/**
 * ПРОФИЛЬ: АДРЕС И ГРУППА (партия 62-C).
 *
 * Поддомен и свой домен — только владелец; смена поддомена оставляет
 * перенаправление со старого адреса (и старых QR), которое снимается
 * вручную. Свой домен — с проверкой DNS и инструкцией; сертификат на него
 * выпускает стенд (`enable-tls.sh`), по слову владельца.
 */

function useRefresh(hotelId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'hotel', hotelId] });
    void qc.invalidateQueries({ queryKey: ['admin', 'history', hotelId] });
    void qc.invalidateQueries({ queryKey: ['admin', 'fleet'] });
  };
}

export function AddressPanel({ hotel }: { hotel: HotelProfile }) {
  const { t } = useTranslation();
  // Старые адреса — на клиенте (партия 62-F), ключ `l…`.
  const aliasSort = useSort('l', ['old', 'created']);
  const aliasColumns: SortColumn<{ old: string; created_at: string }>[] = [
    { key: 'old', label: t('admin.profile.address.sort.old'), kind: 'text', get: (a) => a.old },
    { key: 'created', label: t('admin.profile.address.sort.created'), kind: 'date', get: (a) => a.created_at },
  ];
  const me = useQuery({ queryKey: ['admin', 'me'], queryFn: getMe });
  const owner = me.data?.role === 'owner';
  const refresh = useRefresh(hotel.id);
  const actionFailed = useActionFailed();
  const [subdomain, setSubdomain] = useState(hotel.subdomain);
  const [domain, setDomain] = useState(hotel.custom_domain ?? '');
  const [need, setNeed] = useState<{ body: HotelPatch; need: NeedsConfirmation } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: HotelPatch) => patchHotel(hotel.id, body),
    onSuccess: () => {
      setNeed(null);
      setError(null);
      refresh();
    },
    onError: (cause, body) => {
      if (cause instanceof PlatformError && cause.status === 409 && cause.code === 'needs_confirmation') {
        setNeed({ body, need: cause.data as NeedsConfirmation });
        return;
      }
      setError(cause instanceof Error ? cause.message : t('admin.hotel.saveFailed'));
    },
  });
  const drop = useMutation({ mutationFn: (old: string) => removeAlias(hotel.id, old), onSuccess: refresh, onError: actionFailed });
  const check = useMutation({ mutationFn: () => checkDomain(hotel.id, domain) });

  const subdomainChanged = subdomain.trim().toLowerCase() !== hotel.subdomain;
  const domainChanged = domain.trim().toLowerCase() !== (hotel.custom_domain ?? '');

  return (
    <Box sx={panelSx} data-testid="admin-hotel-address">
      <Typography sx={{ ...typo.panelTitle, color: ink.hi, mb: 0.5, display: 'flex', alignItems: 'center' }}>
        {t('admin.profile.address.title')}
        <Help>{t('admin.profile.address.help')}</Help>
      </Typography>
      {!owner ? (
        <Typography sx={{ ...typo.caption, color: ink.low, mb: 1.25 }} data-testid="admin-hotel-address-owner-only">
          {t('admin.profile.address.ownerOnly')}
        </Typography>
      ) : null}

      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap', mt: 1 }}>
        <TextField
          size="small"
          label={t('admin.profile.field.subdomain')}
          value={subdomain}
          disabled={!owner}
          onChange={(e) => setSubdomain(e.target.value)}
          helperText={t('admin.profile.address.subdomainHint')}
          inputProps={{ 'data-testid': 'admin-hotel-subdomain-input' }}
          sx={{ flex: '1 1 220px' }}
        />
        {owner ? (
          <Button
            sx={secondaryButtonSx}
            disabled={!subdomainChanged || save.isPending}
            onClick={() => save.mutate({ subdomain: subdomain.trim().toLowerCase() })}
            data-testid="admin-hotel-subdomain-save"
          >
            {t('admin.profile.address.change')}
          </Button>
        ) : null}
      </Box>

      {hotel.aliases?.length ? (
        <Box sx={{ mt: 1.5 }} data-testid="admin-hotel-aliases">
          <Typography sx={{ ...typo.label, color: ink.mid, mb: 0.75 }}>{t('admin.profile.address.aliases')}</Typography>
          {hotel.aliases.length > 1 ? (
            <Box sx={{ mb: 1 }}>
              <SortBar state={aliasSort} columns={aliasColumns} testId="admin-hotel-aliases-sort" />
            </Box>
          ) : null}
          {sortRows(hotel.aliases, aliasColumns, aliasSort).map((alias) => (
            <Box key={alias.old} data-testid={`admin-hotel-alias-${alias.old}`} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, borderBottom: `1px solid ${surface.hair}`, ...typo.caption }}>
              <Box sx={{ flex: 1, color: ink.hi, overflowWrap: 'anywhere' }}>
                {t('admin.profile.address.aliasLine', { old: alias.old, now: hotel.subdomain })}
              </Box>
              {owner ? (
                <Button size="small" sx={{ ...typo.caption, color: ink.mid }} onClick={() => drop.mutate(alias.old)} disabled={drop.isPending} data-testid={`admin-hotel-alias-remove-${alias.old}`}>
                  {t('admin.profile.address.removeAlias')}
                </Button>
              ) : null}
            </Box>
          ))}
          <Typography sx={{ ...typo.caption, color: ink.low, mt: 0.75 }}>{t('admin.profile.address.aliasHint')}</Typography>
        </Box>
      ) : null}

      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap', mt: 2 }}>
        <TextField
          size="small"
          label={t('admin.profile.field.custom_domain')}
          value={domain}
          disabled={!owner}
          placeholder="menu.hotel.ru"
          onChange={(e) => {
            setDomain(e.target.value);
            check.reset();
          }}
          inputProps={{ 'data-testid': 'admin-hotel-domain-input' }}
          sx={{ flex: '1 1 220px' }}
        />
        <Button sx={secondaryButtonSx} disabled={!domain.trim() || check.isPending} onClick={() => check.mutate()} data-testid="admin-hotel-domain-check">
          {t('admin.profile.address.check')}
        </Button>
        {owner ? (
          <Button
            sx={primaryButtonSx}
            disabled={!domainChanged || save.isPending}
            onClick={() => save.mutate({ custom_domain: domain.trim() })}
            data-testid="admin-hotel-domain-save"
          >
            {!domain.trim() && hotel.custom_domain ? t('admin.profile.address.removeDomain') : t('admin.hotel.save')}
          </Button>
        ) : null}
      </Box>
      {check.data ? (
        <Box data-testid="admin-hotel-domain-result" sx={{ mt: 1, ...pillSx(check.data.points_here ? 'ok' : 'warn'), display: 'inline-block', whiteSpace: 'normal' }}>
          {check.data.points_here
            ? t('admin.profile.address.pointsHere', { domain: check.data.domain })
            : t('admin.profile.address.pointsElsewhere', {
                domain: check.data.domain,
                resolved: check.data.resolved.join(', ') || t('admin.profile.address.nothing'),
              })}
        </Box>
      ) : null}
      {check.error ? <Alert severity="error" sx={{ mt: 1 }}>{check.error instanceof Error ? check.error.message : ''}</Alert> : null}

      <Box sx={{ mt: 1.5, p: 1.25, borderRadius: `${shape.radius}px`, bgcolor: surface.s2, ...typo.caption, color: ink.mid, display: 'grid', gap: 0.5 }}>
        <Box sx={{ fontWeight: 700, color: ink.hi }}>{t('admin.profile.address.howTitle')}</Box>
        {(['dns', 'check', 'save', 'tls'] as const).map((step, index) => (
          <Box key={step}>
            {index + 1}. {t(`admin.profile.address.how.${step}`)}
          </Box>
        ))}
      </Box>

      {error ? (
        <Alert severity="error" sx={{ mt: 1.5 }} data-testid="admin-hotel-address-error" onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
      {need ? (
        <ConfirmChangesDialog
          need={need.need}
          busy={save.isPending}
          onConfirm={() => save.mutate({ ...need.body, confirm: need.need.fields })}
          onClose={() => setNeed(null)}
        />
      ) : null}
    </Box>
  );
}

export function GroupPanel({ hotel }: { hotel: HotelProfile }) {
  const { t } = useTranslation();
  const refresh = useRefresh(hotel.id);
  const qc = useQueryClient();
  const actionFailed = useActionFailed();
  const me = useQuery({ queryKey: ['admin', 'me'], queryFn: getMe });
  const canWrite = me.data?.role !== 'read_only';
  const groups = useQuery({ queryKey: ['admin', 'groups'], queryFn: getGroups });
  const move = useMutation({
    mutationFn: (groupId: string) => moveHotels([hotel.id], groupId || null),
    onSuccess: () => {
      refresh();
      void qc.invalidateQueries({ queryKey: ['admin', 'groups'] });
    },
    onError: actionFailed,
  });
  const current = hotel.group?.id ?? '';
  return (
    <Box sx={panelSx} data-testid="admin-hotel-group-panel">
      <Typography sx={{ ...typo.panelTitle, color: ink.hi, mb: 0.5, display: 'flex', alignItems: 'center' }}>
        {t('admin.profile.group.title')}
        <Help>{t('admin.profile.group.help')}</Help>
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
        {hotel.group ? <GroupMark color={hotel.group.color} /> : null}
        <SelectField
          size="small"
          label={t('admin.profile.group.label')}
          value={current}
          disabled={!canWrite || move.isPending}
          onChange={(next) => next !== current && move.mutate(next)}
          testId="admin-hotel-group-select"
          options={[
            { value: '', label: t('admin.profile.group.none') },
            ...(groups.data?.items ?? []).map((g) => ({ value: g.id, label: g.title })),
          ]}
        />
      </Box>
      <Typography sx={{ ...typo.caption, color: hotel.group ? ink.low : state.warn, mt: 1 }}>
        {t('admin.profile.group.hint')}
      </Typography>
    </Box>
  );
}
