import { useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import ViewModuleOutlinedIcon from '@mui/icons-material/ViewModuleOutlined';
import ViewListOutlinedIcon from '@mui/icons-material/ViewListOutlined';
import TableRowsOutlinedIcon from '@mui/icons-material/TableRowsOutlined';
import { useTranslation } from 'react-i18next';

import { accent, ink, panelSx, secondaryButtonSx, surface, typo } from '../adminTokens';
import { QueryState } from '@/components/QueryState';
import { useActionFailed } from '@/hooks/useActionFailed';
import { formatDateTime } from '@/utils/dates';
import { useRights } from '../useRights';
import {
  getModuleCard,
  getModulesCatalog,
  putModule,
  type ModuleCatalogItem,
  type ModuleInfo,
  type ModuleJournalRow,
} from '../adminClient';
import { Empty, FilterBar, Help, Hl, Panel, Pill, ViewSwitch, useFacetValues } from './hotels/hotelsUi';

/**
 * КАТАЛОГ МОДУЛЕЙ (партия 62-E1, по макету ModulesCatalogMock) — вместо
 * «Модулей и тарифов». Тарифов нет: модуль включают руками, у отеля или здесь,
 * на странице модуля.
 *
 * Что модуль умеет и чего требует, знает СЕРВЕР (`GET /platform/modules`,
 * реестр модулей): раньше список готовых модулей держал только этот экран, и
 * сервер включал заготовку, не моргнув. Слова «что даёт» и «что открывает» —
 * у экрана, на четырёх языках.
 *
 * Всё состояние — в адресе: вид, поиск, фильтры, открытый модуль.
 */

type View = 'blocks' | 'list' | 'table';

const PAGE = 50;

export function ModulesPage() {
  const [params] = useSearchParams();
  const code = params.get('module');
  return code ? <ModuleCardPage code={code} /> : <Catalog />;
}

/** Название и слова модуля — из словаря экрана по коду. */
function useModuleWords() {
  const { t } = useTranslation();
  return {
    title: (code: string) => t(`admin.module.${code}`),
    gives: (code: string) => t(`admin.moduleInfo.${code}.gives`),
    opens: (code: string) => t(`admin.moduleInfo.${code}.opens`, { returnObjects: true }) as unknown as string[],
    needs: (m: ModuleInfo) => (m.needs ? t(`admin.modules.connection.${m.needs}`) : ''),
  };
}

function StatusPill({ status }: { status: ModuleInfo['status'] }) {
  const { t } = useTranslation();
  return (
    <Pill tone={status === 'ready' ? 'ok' : 'muted'} testId="admin-module-status">
      {t(`admin.modules.status.${status}`)}
    </Pill>
  );
}

function Catalog() {
  const { t } = useTranslation();
  const words = useModuleWords();
  const [params, setParams] = useSearchParams();
  const view = (['blocks', 'list', 'table'].includes(params.get('view') ?? '') ? params.get('view') : 'blocks') as View;
  const values = useFacetValues(['mstate', 'need']);
  const q = (params.get('search') ?? '').trim();
  const catalog = useQuery({ queryKey: ['admin', 'modules-catalog'], queryFn: getModulesCatalog });

  const go = (patch: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace });
  };
  // Открыть модуль — шаг истории: «назад» возвращает к каталогу с его фильтрами.
  const open = (code: string) => {
    const next = new URLSearchParams(params);
    next.set('module', code);
    for (const key of ['search', 'mstate', 'need', 'view']) {
      if (next.get(key)) next.set(`c${key}`, next.get(key)!);
      next.delete(key);
    }
    setParams(next);
  };

  const items = catalog.data?.items ?? [];
  const total = catalog.data?.hotels ?? 0;
  const passes = (selected: string[], value: string) => !selected.length || selected.includes(value);
  const ql = q.toLowerCase();
  const shown = items.filter(
    (m) =>
      passes(values.mstate, m.status) &&
      passes(values.need, m.needs ? 'yes' : 'no') &&
      (!ql || `${words.title(m.code)} ${words.gives(m.code)} ${words.opens(m.code).join(' ')}`.toLowerCase().includes(ql)),
  );
  const count = (pred: (m: ModuleCatalogItem) => boolean) => items.filter(pred).length;

  return (
    <Box data-testid="admin-modules">
      <Typography sx={{ ...typo.pageTitle, color: ink.hi }}>{t('admin.modules.title')}</Typography>
      <Typography sx={{ ...typo.caption, color: ink.mid, mt: 0.5, mb: 2, maxWidth: 760 }}>{t('admin.modules.subtitle')}</Typography>

      <FilterBar
        placeholder={t('admin.modules.search')}
        facets={[
          {
            key: 'mstate',
            label: t('admin.modules.facet.state'),
            options: [
              { value: 'ready', label: t('admin.modules.status.ready'), tone: 'ok', count: count((m) => m.status === 'ready') },
              { value: 'dev', label: t('admin.modules.status.dev'), tone: 'muted', count: count((m) => m.status === 'dev') },
            ],
          },
          {
            key: 'need',
            label: t('admin.modules.facet.need'),
            options: [
              { value: 'yes', label: t('admin.modules.need.yes'), count: count((m) => Boolean(m.needs)) },
              { value: 'no', label: t('admin.modules.need.no'), count: count((m) => !m.needs) },
            ],
          },
        ]}
        aside={
          <ViewSwitch
            label={t('admin.modules.view.label')}
            value={view}
            testIdPrefix="admin-modules-view"
            onChange={(v) => go({ view: v === 'blocks' ? null : v }, true)}
            options={[
              ['blocks', t('admin.modules.view.blocks'), <ViewModuleOutlinedIcon key="b" fontSize="small" />],
              ['list', t('admin.modules.view.list'), <ViewListOutlinedIcon key="l" fontSize="small" />],
              ['table', t('admin.modules.view.table'), <TableRowsOutlinedIcon key="t" fontSize="small" />],
            ]}
          />
        }
      />

      <QueryState
        query={catalog}
        what={t('state.what.modules')}
        isEmpty={(data) => data.items.length === 0}
        emptyText={t('admin.modules.catalogEmpty')}
      >
        {() =>
          !shown.length ? (
            <Box sx={panelSx}>
              <Empty title={t('admin.modules.emptyTitle')} testId="admin-modules-empty">
                {t('admin.modules.emptyText')}
              </Empty>
            </Box>
          ) : view === 'blocks' ? (
            <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(3, 1fr)' } }}>
              {shown.map((m) => (
                <ButtonBase
                  key={m.code}
                  onClick={() => open(m.code)}
                  data-testid={`admin-modules-item-${m.code}`}
                  data-status={m.status}
                  sx={{
                    ...panelSx,
                    display: 'block',
                    textAlign: 'start',
                    opacity: m.status === 'dev' ? 0.85 : 1,
                    borderStyle: m.status === 'dev' ? 'dashed' : undefined,
                  }}
                >
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography sx={{ ...typo.panelTitle, color: ink.hi }}>
                      <Hl text={words.title(m.code)} q={q} />
                    </Typography>
                    <StatusPill status={m.status} />
                  </Box>
                  <Typography sx={{ ...typo.body, color: ink.mid, mt: 0.75, minHeight: 42 }}>
                    <Hl text={words.gives(m.code)} q={q} />
                  </Typography>
                  <Box sx={{ display: 'grid', gap: 0.25, mt: 1.5, ...typo.caption, color: ink.mid }}>
                    <span>
                      {m.status === 'ready'
                        ? t('admin.modules.enabledIn', { count: m.enabled_hotels, total })
                        : t('admin.modules.cannotEnable')}
                    </span>
                    {m.needs ? <span>{t('admin.modules.needs', { what: words.needs(m) })}</span> : null}
                  </Box>
                </ButtonBase>
              ))}
            </Box>
          ) : view === 'list' ? (
            <Box sx={{ ...panelSx, p: 0 }}>
              {shown.map((m, i) => (
                <ButtonBase
                  key={m.code}
                  onClick={() => open(m.code)}
                  data-testid={`admin-modules-item-${m.code}`}
                  data-status={m.status}
                  sx={{
                    display: 'flex',
                    width: '100%',
                    gap: 1.5,
                    alignItems: 'center',
                    textAlign: 'start',
                    px: 2,
                    py: 1.5,
                    borderTop: i ? `1px solid ${surface.hair}` : 'none',
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ ...typo.body, fontWeight: 700, color: ink.hi }}>
                      <Hl text={words.title(m.code)} q={q} />
                    </Box>
                    <Box sx={{ ...typo.caption, color: ink.mid }}>
                      <Hl text={words.gives(m.code)} q={q} />
                    </Box>
                  </Box>
                  <Box sx={{ ...typo.caption, color: ink.mid, display: { xs: 'none', sm: 'block' }, whiteSpace: 'nowrap' }}>
                    {m.status === 'ready' ? t('admin.modules.enabledIn', { count: m.enabled_hotels, total }) : ''}
                  </Box>
                  <StatusPill status={m.status} />
                </ButtonBase>
              ))}
            </Box>
          ) : (
            <Box sx={{ ...panelSx, p: 0, overflowX: 'auto' }}>
              <Box
                component="table"
                data-testid="admin-modules-table"
                sx={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  ...typo.body,
                  '& td, & th': { px: 1.5, py: 1.1, borderBottom: `1px solid ${surface.hair}`, textAlign: 'start' },
                }}
              >
                <Box component="thead">
                  <Box component="tr" sx={{ '& th': { ...typo.label, color: ink.mid, whiteSpace: 'nowrap' } }}>
                    <th>{t('admin.modules.col.module')}</th>
                    <th>{t('admin.modules.col.gives')}</th>
                    <th>{t('admin.modules.col.state')}</th>
                    <th>{t('admin.modules.col.need')}</th>
                    <th>{t('admin.modules.col.hotels')}</th>
                  </Box>
                </Box>
                <Box component="tbody">
                  {shown.map((m) => (
                    <Box
                      component="tr"
                      key={m.code}
                      onClick={() => open(m.code)}
                      data-testid={`admin-modules-item-${m.code}`}
                      sx={{ cursor: 'pointer', '&:hover': { bgcolor: surface.s2 } }}
                    >
                      <Box component="td" sx={{ fontWeight: 700, color: ink.hi, whiteSpace: 'nowrap' }}>
                        <Hl text={words.title(m.code)} q={q} />
                      </Box>
                      <Box component="td" sx={{ color: ink.mid, minWidth: 240 }}>
                        <Hl text={words.gives(m.code)} q={q} />
                      </Box>
                      <td>
                        <StatusPill status={m.status} />
                      </td>
                      <Box component="td" sx={{ color: ink.mid }}>{m.needs ? words.needs(m) : '—'}</Box>
                      <Box component="td" sx={{ color: ink.mid, whiteSpace: 'nowrap' }}>
                        {m.status === 'ready' ? `${m.enabled_hotels} / ${total}` : '—'}
                      </Box>
                    </Box>
                  ))}
                </Box>
              </Box>
            </Box>
          )
        }
      </QueryState>
    </Box>
  );
}

/* ── Страница модуля ─────────────────────────────────────────────────────── */

function ModuleCardPage({ code }: { code: string }) {
  const { t } = useTranslation();
  const words = useModuleWords();
  const actionFailed = useActionFailed();
  const { canWrite } = useRights();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const stateFilter = useFacetValues(['state']).state;
  // «включён» и «выключен» вместе — то же, что без фильтра.
  const state = stateFilter.length === 1 ? stateFilter[0] : '';
  const search = (params.get('search') ?? '').trim();

  const card = useInfiniteQuery({
    queryKey: ['admin', 'module', code, state, search],
    queryFn: ({ pageParam }) => getModuleCard(code, { state, search, cursor: pageParam || undefined, limit: PAGE }),
    initialPageParam: '',
    getNextPageParam: (last) => last.hotels.next_cursor ?? undefined,
  });

  const toggle = useMutation({
    mutationFn: (body: { hotelId: string; enabled: boolean }) => putModule(body.hotelId, code, body.enabled),
    onSuccess: (_result, body) => {
      void qc.invalidateQueries({ queryKey: ['admin', 'module', code] });
      void qc.invalidateQueries({ queryKey: ['admin', 'modules-catalog'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'modules', body.hotelId] });
      void qc.invalidateQueries({ queryKey: ['admin', 'readiness', body.hotelId] });
    },
    onError: actionFailed,
  });

  // «← Все модули» возвращает каталог с его поиском, фильтрами и видом.
  const back = () => {
    const next = new URLSearchParams(params);
    next.delete('module');
    for (const key of ['search', 'state']) next.delete(key);
    for (const key of ['search', 'mstate', 'need', 'view']) {
      const saved = next.get(`c${key}`);
      next.delete(`c${key}`);
      if (saved) next.set(key, saved);
    }
    setParams(next);
  };
  const openHotel = (hotelId: string) => {
    const next = new URLSearchParams();
    next.set('section', 'fleet');
    next.set('hotel', hotelId);
    next.set('tab', 'modules');
    setParams(next);
  };

  const first = card.data?.pages[0];
  const rows = card.data?.pages.flatMap((page) => page.hotels.items) ?? [];

  return (
    <Box data-testid="admin-module-page" data-module={code}>
      <Button size="small" sx={{ color: accent.soft, mb: 1, px: 0.5 }} onClick={back} data-testid="admin-module-back">
        {t('admin.modules.back')}
      </Button>
      <QueryState query={card} what={t('state.what.moduleCard')}>
        {() =>
          first ? (
            <>
              <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography component="h1" sx={{ ...typo.pageTitle, color: ink.hi }}>{words.title(code)}</Typography>
                <StatusPill status={first.status} />
              </Box>
              <Typography sx={{ ...typo.body, color: ink.mid, mt: 0.5, mb: 2, maxWidth: 760 }}>{words.gives(code)}</Typography>
              {first.status === 'dev' ? (
                <Box sx={{ ...panelSx, borderStyle: 'dashed', mb: 2, ...typo.caption, color: ink.mid }} data-testid="admin-module-dev-note">
                  {t('admin.modules.devNote')}
                </Box>
              ) : null}

              <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, alignItems: 'start' }}>
                <Box sx={{ display: 'grid', gap: 2, minWidth: 0 }}>
                  <Panel title={t('admin.modules.opens')}>
                    {words.opens(code).map((line) => (
                      <Box key={line} sx={{ ...typo.body, color: ink.hi, py: 0.4 }}>
                        • {line}
                      </Box>
                    ))}
                    {first.needs ? (
                      <Box sx={{ ...typo.caption, color: ink.mid, mt: 1 }}>
                        {t('admin.modules.needsNote', { what: words.needs(first) })}
                      </Box>
                    ) : null}
                  </Panel>
                  <Panel title={t('admin.modules.defaults')}>
                    {Object.keys(first.config_defaults).length ? (
                      Object.entries(first.config_defaults).map(([key, value]) => (
                        <Box
                          key={key}
                          sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.9, borderBottom: `1px solid ${surface.hair}`, ...typo.caption, color: ink.mid }}
                        >
                          <Box component="span" sx={{ flex: 1 }}>
                            {t(`admin.moduleInfo.config.${key}`)}
                            <Help>{t('admin.modules.defaultsHelp')}</Help>
                          </Box>
                          <Box component="b" sx={{ color: ink.hi, fontWeight: 600 }}>
                            {typeof value === 'boolean'
                              ? t(value ? 'admin.modules.valueOn' : 'admin.modules.valueOff')
                              : String(value)}
                          </Box>
                        </Box>
                      ))
                    ) : (
                      <Empty title={t('admin.modules.defaultsEmpty')} testId="admin-module-defaults-empty">
                        {t('admin.modules.defaultsEmptyText')}
                      </Empty>
                    )}
                  </Panel>
                </Box>

                <Box sx={{ display: 'grid', gap: 2, minWidth: 0 }}>
                  <Panel
                    title={t('admin.modules.hotels')}
                    aside={
                      <Box sx={{ ...typo.caption, color: ink.low, display: 'inline-flex', alignItems: 'center' }} data-testid="admin-module-counts">
                        {t('admin.modules.hotelsCount', { on: first.counts.on, total: first.counts.on + first.counts.off })}
                        <Help>{t('admin.modules.hotelsHelp')}</Help>
                      </Box>
                    }
                  >
                    <FilterBar
                      placeholder={t('admin.modules.hotelSearch')}
                      facets={[
                        {
                          key: 'state',
                          label: t('admin.modules.facet.on'),
                          options: [
                            { value: 'on', label: t('admin.modules.on'), tone: 'ok', count: first.counts.on },
                            { value: 'off', label: t('admin.modules.off'), tone: 'muted', count: first.counts.off },
                          ],
                        },
                      ]}
                    />
                    {!rows.length ? (
                      <Empty title={t('admin.modules.noHotels')} testId="admin-module-hotels-empty">
                        {t('admin.modules.noHotelsText')}
                      </Empty>
                    ) : null}
                    {rows.map((hotel) => (
                      <Box
                        key={hotel.id}
                        data-testid={`admin-module-hotel-${hotel.subdomain}`}
                        data-enabled={hotel.enabled ? 'true' : 'false'}
                        sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.75, borderBottom: `1px solid ${surface.hair}` }}
                      >
                        <ButtonBase
                          onClick={() => openHotel(hotel.id)}
                          sx={{ flex: 1, minWidth: 0, justifyContent: 'flex-start', textAlign: 'start', borderRadius: 1 }}
                        >
                          <Box sx={{ minWidth: 0 }}>
                            <Box sx={{ ...typo.body, fontWeight: 700, color: ink.hi, overflowWrap: 'anywhere' }}>
                              <Hl text={hotel.name} q={search} />
                            </Box>
                            <Box sx={{ ...typo.caption, color: ink.mid }}>
                              <Hl text={hotel.subdomain} q={search} />
                              {!hotel.is_active ? ` · ${t('admin.modules.disabledHotel')}` : ''}
                            </Box>
                          </Box>
                        </ButtonBase>
                        {first.status === 'ready' || hotel.enabled ? (
                          <>
                            {first.status === 'dev' ? <Pill tone="warn">{t('admin.modules.wasOn')}</Pill> : null}
                            <Switch
                              checked={hotel.enabled}
                              disabled={!canWrite || toggle.isPending}
                              onChange={(e) => toggle.mutate({ hotelId: hotel.id, enabled: e.target.checked })}
                              inputProps={{
                                'aria-label': t('admin.modules.toggleLabel', { module: words.title(code), hotel: hotel.name }),
                                'data-testid': `admin-module-hotel-toggle-${hotel.subdomain}`,
                              } as Record<string, string>}
                            />
                            <Help>{t(first.status === 'dev' ? 'admin.modules.devHelp' : 'admin.modules.toggleHelp')}</Help>
                          </>
                        ) : (
                          <Box sx={{ ...typo.caption, color: ink.low, display: 'inline-flex', alignItems: 'center' }}>
                            {t('admin.modules.cannotEnable')}
                            <Help>{t('admin.modules.devHelp')}</Help>
                          </Box>
                        )}
                      </Box>
                    ))}
                    {card.hasNextPage ? (
                      <Button
                        size="small"
                        sx={{ ...secondaryButtonSx, mt: 1.5 }}
                        disabled={card.isFetchingNextPage}
                        onClick={() => void card.fetchNextPage()}
                        data-testid="admin-module-hotels-more"
                      >
                        {t('admin.modules.more')}
                      </Button>
                    ) : null}
                  </Panel>
                  <Panel title={t('admin.modules.journal')} aside={<Help>{t('admin.modules.journalHelp')}</Help>}>
                    {first.journal.length ? (
                      first.journal.map((row) => <JournalLine key={row.id} row={row} />)
                    ) : (
                      <Empty title={t('admin.modules.journalEmpty')} testId="admin-module-journal-empty">
                        {t('admin.modules.journalEmptyText')}
                      </Empty>
                    )}
                  </Panel>
                </Box>
              </Box>
            </>
          ) : null
        }
      </QueryState>
    </Box>
  );
}

function JournalLine({ row }: { row: ModuleJournalRow }) {
  const { t } = useTranslation();
  const hotel = row.hotel || row.subdomain;
  const text =
    row.reason === 'in_development'
      ? t('admin.modules.journalDev', { hotel })
      : t(row.to ? 'admin.modules.journalOn' : 'admin.modules.journalOff', { hotel });
  const actor = row.actor.role === 'system' ? t('admin.modules.system') : row.actor.name || row.actor.email;
  return (
    <Box sx={{ py: 0.75, borderBottom: `1px solid ${surface.hair}` }} data-testid="admin-module-journal-row">
      <Box sx={{ ...typo.caption, color: ink.low }}>
        {formatDateTime(row.at)} · {actor}
      </Box>
      <Box sx={{ ...typo.body, color: ink.hi }}>{text}</Box>
    </Box>
  );
}
