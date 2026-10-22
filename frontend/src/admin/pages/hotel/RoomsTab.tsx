import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { QueryState } from '@/components/QueryState';
import { ink, surface, typo } from '../../adminTokens';
import { getHotelRooms, type RoomsPage } from '../../adminClient';
import { Empty, FilterBar, Hl, Panel, Pill, type Facet } from '../hotels/hotelsUi';
import { SortHeader, useSort, type SortState } from '../../sort';

/**
 * НОМЕРНОЙ ФОНД — ПОКА ТОЛЬКО ЧТЕНИЕ (партия 62-B). Номер, корпус, этаж,
 * категория, вариант управления, есть ли PIN. Поиск и фильтры — в адресе,
 * считает сервер. Полноценный экран с правкой — отдельная партия.
 */

const FACET_KEYS = ['building', 'floor', 'category', 'variant', 'pin'] as const;

export function RoomsTab({ hotelId }: { hotelId: string }) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  // Порядок считает сервер (партия 62-F): номер и этаж — «по-человечески».
  const sort = useSort('', ['number', ...FACET_KEYS]);
  const query: Record<string, string> = {
    ...Object.fromEntries(['search', ...FACET_KEYS].map((k) => [k, params.get(k) ?? ''])),
    ...sort.query,
  };
  const rooms = useQuery({
    queryKey: ['admin', 'hotel-rooms', hotelId, query],
    queryFn: () => getHotelRooms(hotelId, query),
    placeholderData: keepPreviousData,
  });

  return (
    <Panel title={t('admin.card.rooms.title')}>
      <QueryState query={rooms} what={t('admin.card.rooms.what')}>
        {(page) => <Rooms page={page} search={query.search} sort={sort} />}
      </QueryState>
    </Panel>
  );
}

function Rooms({ page, search, sort }: { page: RoomsPage; search: string; sort: SortState }) {
  const { t } = useTranslation();
  const label = (key: (typeof FACET_KEYS)[number], value: string, fallback: string) => {
    if (value === 'none') return t('admin.card.rooms.none');
    if (key === 'pin') return t(`admin.card.rooms.pin.${value}`);
    return fallback;
  };
  const facets: Facet[] = FACET_KEYS.map((key) => ({
    key,
    label: t(`admin.card.rooms.col.${key}`),
    options: page.facets[key].map((o) => ({ value: o.value, label: label(key, o.value, o.label), count: o.count })),
  }));
  const cell = { p: '10px 12px', borderBottom: `1px solid ${surface.hair}`, color: ink.mid, whiteSpace: 'nowrap' } as const;

  return (
    <Box data-testid="admin-rooms">
      <FilterBar facets={facets} placeholder={t('admin.card.rooms.search')} />
      <Typography sx={{ ...typo.caption, color: ink.mid, mb: 1 }} data-testid="admin-rooms-count">
        {t('admin.card.rooms.count', { found: page.found, total: page.total })}
        {!page.room_control ? ` · ${t('admin.card.rooms.moduleOff')}` : ''}
      </Typography>
      {!page.total ? (
        <Empty title={t('admin.card.rooms.emptyTitle')}>{t('admin.card.rooms.emptyBody')}</Empty>
      ) : !page.found ? (
        <Empty title={t('admin.card.rooms.noMatch')}>{t('admin.card.rooms.noMatchBody')}</Empty>
      ) : (
        <Box sx={{ overflowX: 'auto', mx: { xs: -1, md: 0 } }}>
          <Box component="table" sx={{ width: '100%', minWidth: 640, borderCollapse: 'collapse', ...typo.body }}>
            <Box component="thead">
              <Box component="tr">
                {(['number', ...FACET_KEYS] as const).map((key) => (
                  <SortHeader key={key} column={{ key, label: t(`admin.card.rooms.col.${key}`) }} state={sort} testId={`admin-rooms-sort-${key}`} />
                ))}
              </Box>
            </Box>
            <Box component="tbody">
              {page.items.map((room) => (
                <Box component="tr" key={room.id} data-testid={`admin-room-${room.number}`}>
                  <Box component="td" sx={{ ...cell, color: ink.hi, fontWeight: 700 }}>
                    <Hl text={room.number} q={search} />
                    {!room.is_active ? <Box component="span" sx={{ ml: 1 }}><Pill tone="muted">{t('admin.card.rooms.inactive')}</Pill></Box> : null}
                  </Box>
                  <Box component="td" sx={cell}>{room.building || '—'}</Box>
                  <Box component="td" sx={cell}>{room.floor || '—'}</Box>
                  <Box component="td" sx={cell}>{room.category || '—'}</Box>
                  <Box component="td" sx={cell}>{room.variant ? room.variant.title : <Box component="span" sx={{ color: ink.low }}>{t('admin.card.rooms.noVariant')}</Box>}</Box>
                  <Box component="td" sx={cell}>
                    <Pill tone={room.pin ? 'ok' : 'muted'}>{t(`admin.card.rooms.pin.${room.pin ? 'yes' : 'no'}`)}</Pill>
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>
          {page.truncated ? (
            <Typography sx={{ ...typo.caption, color: ink.mid, mt: 1 }}>{t('state.truncated', { shown: page.items.length, total: page.found })}</Typography>
          ) : null}
        </Box>
      )}
    </Box>
  );
}
