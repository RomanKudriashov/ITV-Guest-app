import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import InputBase from '@mui/material/InputBase';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { accent, ink, pillSx, primaryButtonSx, state, surface } from '../adminTokens';
import { CreateHotelDialog, CreatedAdminDialog } from '../CreateHotelDialog';
import {
  bulkSetActive,
  downloadFleetCsv,
  getFleet,
  type CreateHotelResult,
  type FleetQuery,
  type FleetRow,
} from '../adminClient';

const STATUS_TONE = {
  active: 'ok',
  trial: 'info',
  disabled: 'muted',
} as const;

/**
 * Реестр отелей — рабочий экран платформы.
 *
 * Поиск, фильтры и сортировка живут в АДРЕСЕ запроса, а не в памяти клиента:
 * отфильтрованный список должен переживать перезагрузку и уходить в экспорт
 * ровно тем же срезом, который человек видит на экране.
 *
 * Выделение и массовые действия намеренно ограничены включением/выключением:
 * это единственная операция над отелем, которая обратима одним нажатием. Всё
 * необратимое (удаление, офбординг) делается по одному отелю и с подтверждением.
 */
export function FleetPage({ onOpenHotel }: { onOpenHotel: (id: string) => void }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [query, setQuery] = useState<FleetQuery>({ status: '', page: 1, page_size: 25 });
  const [selected, setSelected] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreateHotelResult | null>(null);

  const fleet = useQuery({ queryKey: ['admin', 'fleet', query], queryFn: () => getFleet(query) });
  const bulk = useMutation({
    mutationFn: (isActive: boolean) => bulkSetActive(selected, isActive),
    onSuccess: () => {
      setSelected([]);
      void qc.invalidateQueries({ queryKey: ['admin', 'fleet'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
    },
  });

  const patch = (next: Partial<FleetQuery>) =>
    setQuery((prev) => ({ ...prev, ...next, page: next.page ?? 1 }));

  const rows = fleet.data?.items ?? [];
  const facets = fleet.data?.facets;
  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <Box data-testid="admin-fleet">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography sx={{ fontSize: 24, fontWeight: 800, letterSpacing: '-.02em' }}>
            {t('admin.fleet.title')}
          </Typography>
          <Typography sx={{ color: ink.low, fontSize: 13, mt: 0.5 }}>
            {t('admin.fleet.subtitle')}
          </Typography>
        </Box>
        <Button
          onClick={() => void downloadFleetCsv(query)}
          data-testid="admin-fleet-export"
          sx={{ color: ink.mid, border: `1px solid ${surface.line}`, bgcolor: surface.s2 }}
        >
          {t('admin.fleet.export')}
        </Button>
        <Button onClick={() => setCreating(true)} data-testid="admin-create-open" sx={primaryButtonSx}>
          {t('admin.fleet.create')}
        </Button>
      </Box>

      <Box sx={{ display: 'flex', gap: 1, mt: 2.25, flexWrap: 'wrap', alignItems: 'center' }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            height: 34,
            width: 280,
            px: 1.5,
            borderRadius: '10px',
            border: `1px solid ${surface.line}`,
            bgcolor: surface.s2,
          }}
        >
          <InputBase
            value={query.search ?? ''}
            onChange={(e) => patch({ search: e.target.value })}
            placeholder={t('admin.fleet.searchPlaceholder')}
            inputProps={{ 'data-testid': 'admin-fleet-search' }}
            sx={{ fontSize: 12.5, color: ink.hi, width: '100%' }}
          />
        </Box>

        {(['', 'active', 'trial', 'disabled'] as const).map((status) => (
          <ButtonBase
            key={status || 'all'}
            onClick={() => patch({ status })}
            data-testid={`admin-fleet-filter-${status || 'all'}`}
            data-active={query.status === status ? 'true' : undefined}
            sx={{
              height: 32,
              px: 1.5,
              borderRadius: '9px',
              fontSize: 12,
              fontWeight: 600,
              border: `1px solid ${query.status === status ? accent.main : surface.line}`,
              bgcolor: query.status === status ? accent.washSoft : surface.s2,
              color: query.status === status ? accent.soft : ink.mid,
            }}
          >
            {t(`admin.fleet.status.${status || 'all'}`)}
            {facets ? ` · ${facets[(status || 'all') as keyof typeof facets]}` : ''}
          </ButtonBase>
        ))}

        <ButtonBase
          onClick={() => patch({ sort: query.sort === 'name' ? '-name' : 'name' })}
          data-testid="admin-fleet-sort-name"
          sx={{ ml: 'auto', fontSize: 12, fontWeight: 600, color: ink.mid, px: 1.25, py: 1 }}
        >
          {t('admin.fleet.sortByName')}
          {query.sort === '-name' ? ' ↓' : query.sort === 'name' ? ' ↑' : ''}
        </ButtonBase>
      </Box>

      {selected.length ? (
        <Box
          data-testid="admin-fleet-bulkbar"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            mt: 1.5,
            p: 1.5,
            borderRadius: '12px',
            bgcolor: accent.washSoft,
            border: `1px solid ${accent.main}`,
          }}
        >
          <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: accent.soft }}>
            {t('admin.fleet.selected', { count: selected.length })}
          </Typography>
          <Button
            size="small"
            onClick={() => bulk.mutate(true)}
            disabled={bulk.isPending}
            data-testid="admin-fleet-bulk-enable"
            sx={primaryButtonSx}
          >
            {t('admin.fleet.bulkEnable')}
          </Button>
          <Button
            size="small"
            onClick={() => bulk.mutate(false)}
            disabled={bulk.isPending}
            data-testid="admin-fleet-bulk-disable"
            sx={{ color: ink.mid, border: `1px solid ${surface.line}` }}
          >
            {t('admin.fleet.bulkDisable')}
          </Button>
          {bulk.data ? (
            <Typography sx={{ fontSize: 12, color: ink.mid }} data-testid="admin-fleet-bulk-result">
              {t('admin.fleet.bulkResult', { changed: bulk.data.changed, requested: bulk.data.requested })}
            </Typography>
          ) : null}
        </Box>
      ) : null}

      {fleet.isLoading ? (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : fleet.isError ? (
        <Alert severity="error" sx={{ mt: 2 }}>
          {t('admin.fleet.loadFailed')}
        </Alert>
      ) : (
        <Box sx={{ mt: 1.5, overflowX: 'auto' }}>
          <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <Box component="thead">
              <Box component="tr">
                <Th />
                <Th>{t('admin.fleet.col.hotel')}</Th>
                <Th>{t('admin.fleet.col.tariff')}</Th>
                <Th align="right">{t('admin.fleet.col.rooms')}</Th>
                <Th align="right">{t('admin.fleet.col.services')}</Th>
                <Th align="right">{t('admin.fleet.col.orders')}</Th>
                <Th>{t('admin.fleet.col.status')}</Th>
              </Box>
            </Box>
            <Box component="tbody">
              {rows.map((row) => (
                <Row
                  key={row.id}
                  row={row}
                  checked={selected.includes(row.id)}
                  onToggle={() => toggle(row.id)}
                  onOpen={() => onOpenHotel(row.id)}
                  language={i18n.language}
                />
              ))}
            </Box>
          </Box>
          {rows.length === 0 ? (
            <Typography sx={{ color: ink.low, fontSize: 13, py: 4, textAlign: 'center' }}
              data-testid="admin-fleet-empty">
              {t('admin.fleet.empty')}
            </Typography>
          ) : null}
        </Box>
      )}

      {creating ? (
        <CreateHotelDialog
          onClose={() => setCreating(false)}
          onCreated={(result) => {
            setCreating(false);
            setCreated(result);
            void qc.invalidateQueries({ queryKey: ['admin', 'fleet'] });
            void qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
          }}
        />
      ) : null}
      {created ? (
        <CreatedAdminDialog
          admin={created.admin}
          services={created.services ?? []}
          onClose={() => setCreated(null)}
        />
      ) : null}

      {fleet.data && fleet.data.pages > 1 ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 2 }} data-testid="admin-fleet-pager">
          <Button
            size="small"
            disabled={fleet.data.page <= 1}
            onClick={() => patch({ page: fleet.data!.page - 1 })}
            data-testid="admin-fleet-prev"
            sx={{ color: ink.mid }}
          >
            {t('admin.fleet.prev')}
          </Button>
          <Typography sx={{ fontSize: 12.5, color: ink.mid }}>
            {t('admin.fleet.pageOf', { page: fleet.data.page, pages: fleet.data.pages })}
          </Typography>
          <Button
            size="small"
            disabled={fleet.data.page >= fleet.data.pages}
            onClick={() => patch({ page: fleet.data!.page + 1 })}
            data-testid="admin-fleet-next"
            sx={{ color: ink.mid }}
          >
            {t('admin.fleet.next')}
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}

function Th({ children, align }: { children?: React.ReactNode; align?: 'right' }) {
  return (
    <Box
      component="th"
      sx={{
        textAlign: align ?? 'left',
        fontSize: 10.5,
        letterSpacing: '.1em',
        textTransform: 'uppercase',
        color: ink.low,
        fontWeight: 700,
        p: '11px 12px',
        borderBottom: `1px solid ${surface.line}`,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Box>
  );
}

function Row({
  row,
  checked,
  onToggle,
  onOpen,
  language,
}: {
  row: FleetRow;
  checked: boolean;
  onToggle: () => void;
  onOpen: () => void;
  language: string;
}) {
  const { t } = useTranslation();
  const cell = {
    p: '13px 12px',
    borderBottom: `1px solid ${surface.hair}`,
    color: ink.mid,
  } as const;

  return (
    <Box component="tr" data-testid={`admin-fleet-row-${row.subdomain}`} sx={{ '&:hover td': { bgcolor: surface.s2 } }}>
      <Box component="td" sx={{ ...cell, width: 44 }}>
        <Checkbox
          size="small"
          checked={checked}
          onChange={onToggle}
          inputProps={{ 'data-testid': `admin-fleet-pick-${row.subdomain}` } as Record<string, string>}
          sx={{ color: ink.low, '&.Mui-checked': { color: accent.main } }}
        />
      </Box>
      <Box component="td" sx={cell}>
        <ButtonBase
          onClick={onOpen}
          data-testid={`admin-fleet-open-${row.subdomain}`}
          sx={{ display: 'block', textAlign: 'left' }}
        >
          <Typography sx={{ color: ink.hi, fontWeight: 700, fontSize: 13 }}>{row.name}</Typography>
          <Typography sx={{ fontSize: 11, color: ink.low }}>{row.subdomain}</Typography>
        </ButtonBase>
      </Box>
      <Box component="td" sx={cell}>
        <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: state.gold }}>
          {row.tariff_title[language] ?? row.tariff_title.en ?? row.tariff}
        </Typography>
      </Box>
      <Box component="td" sx={{ ...cell, textAlign: 'right' }}>{row.counts.rooms}</Box>
      <Box component="td" sx={{ ...cell, textAlign: 'right' }}>{row.counts.services}</Box>
      <Box component="td" sx={{ ...cell, textAlign: 'right' }}>{row.counts.orders_7d}</Box>
      <Box component="td" sx={cell}>
        <Box
          data-testid={`admin-fleet-status-${row.subdomain}`}
          sx={{
            display: 'inline-block',
            fontSize: 10.5,
            fontWeight: 700,
            px: 1.1,
            py: 0.4,
            borderRadius: 999,
            ...pillSx(STATUS_TONE[row.status]),
          }}
        >
          {row.status === 'trial' && row.trial_days_left !== null
            ? t('admin.fleet.trialDays', { days: row.trial_days_left })
            : t(`admin.fleet.status.${row.status}`)}
        </Box>
        {/* Узел офлайн важнее статуса отеля: отель «активен», а половина его
            функций не работает — и понять это нужно из списка, не проваливаясь. */}
        {row.node_offline ? (
          <Box
            data-testid={`admin-fleet-node-offline-${row.subdomain}`}
            sx={{
              display: 'inline-block',
              ml: 0.75,
              fontSize: 10.5,
              fontWeight: 700,
              px: 1.1,
              py: 0.4,
              borderRadius: 999,
              ...pillSx('warn'),
            }}
          >
            {t('admin.fleet.nodeOffline')}
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}
