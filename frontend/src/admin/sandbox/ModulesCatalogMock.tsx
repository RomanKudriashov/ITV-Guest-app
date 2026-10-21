import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import ViewModuleOutlinedIcon from '@mui/icons-material/ViewModuleOutlined';
import ViewListOutlinedIcon from '@mui/icons-material/ViewListOutlined';
import TableRowsOutlinedIcon from '@mui/icons-material/TableRowsOutlined';

import { accent, ink, panelSx, secondaryButtonSx, surface, typo } from '../adminTokens';
import { getAudit } from '../adminClient';
import type { Go } from './SandboxApp';
import { useFleetLines, type HotelLine } from './sandboxData';
import { CONNECTION_TITLE, MODULES, moduleByCode, type CatalogModule } from './moduleCatalog';
import { plural } from './readiness';
import { FilterBar, passes, useFilters } from './FilterBar';
import { dateTime } from './words';
import { DevTag, Empty, Help, Hl, KV, PageHead, Panel, Pill, Sample, Toggle, ViewSwitch } from './ui';

/**
 * МАКЕТ 5 — КАТАЛОГ МОДУЛЕЙ (партия 62, второй заход): вместо «Модулей и
 * тарифов». Тарифов нет: модуль включают руками у отеля или здесь.
 */

type View = 'blocks' | 'list' | 'table';

export function ModulesCatalogMock({ go }: { go: Go }) {
  const [params] = useSearchParams();
  const view = (params.get('view') as View) || 'blocks';
  const code = params.get('module');
  const { q, values } = useFilters(['mstate', 'need']);
  const { lines } = useFleetLines();
  const active = lines.filter((l) => l.row.is_active);
  const enabledIn = (m: CatalogModule) => active.filter((l) => l.modules.some((x) => x.code === m.code && x.is_enabled));

  if (code && moduleByCode(code)) return <ModulePage module={moduleByCode(code)!} lines={active} go={go} />;

  const ql = q.toLowerCase();
  const shown = MODULES.filter(
    (m) =>
      passes(values.mstate, m.status) &&
      passes(values.need, m.needs ? 'yes' : 'no') &&
      (!ql || `${m.title} ${m.gives} ${m.opens.join(' ')}`.toLowerCase().includes(ql)),
  );

  return (
    <Box>
      <PageHead
        title="Модули"
        subtitle="Модуль — часть продукта, которую включают отелю отдельно: управление номером, маркетинг и другие. Откройте модуль, чтобы увидеть, что он даёт, у каких отелей включён, и включить или выключить его сразу у нескольких."
      />
      <FilterBar
        go={go}
        placeholder="Название модуля или что он даёт"
        facets={[
          {
            key: 'mstate',
            label: 'Состояние',
            options: [
              { value: 'ready', label: 'работает', tone: 'ok', count: MODULES.filter((m) => m.status === 'ready').length },
              { value: 'dev', label: 'в разработке', tone: 'muted', count: MODULES.filter((m) => m.status === 'dev').length },
            ],
          },
          {
            key: 'need',
            label: 'Подключение',
            options: [
              { value: 'yes', label: 'нужно подключение', count: MODULES.filter((m) => m.needs).length },
              { value: 'no', label: 'работает само', count: MODULES.filter((m) => !m.needs).length },
            ],
          },
        ]}
        aside={
          <ViewSwitch
            label="Вид"
            value={view}
            onChange={(v) => go({ view: v === 'blocks' ? null : v }, true)}
            options={[
              ['blocks', 'Блоки', <ViewModuleOutlinedIcon key="b" fontSize="small" />],
              ['list', 'Список', <ViewListOutlinedIcon key="l" fontSize="small" />],
              ['table', 'Таблица', <TableRowsOutlinedIcon key="t" fontSize="small" />],
            ]}
          />
        }
      />

      {!shown.length ? <Box sx={panelSx}><Empty title="Ничего не нашлось">Ни один модуль не подходит под поиск и фильтры. Нажмите «Сбросить».</Empty></Box> : null}

      {view === 'blocks' && shown.length ? (
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(3, 1fr)' } }}>
          {shown.map((m) => (
            <ButtonBase
              key={m.code}
              onClick={() => go({ module: m.code })}
              sx={{ ...panelSx, display: 'block', textAlign: 'left', opacity: m.status === 'dev' ? 0.8 : 1, borderStyle: m.status === 'dev' ? 'dashed' : undefined }}
            >
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography sx={{ ...typo.panelTitle, color: ink.hi }}><Hl text={m.title} q={q} /></Typography>
                {m.status === 'ready' ? <Pill tone="ok">работает</Pill> : <DevTag />}
              </Box>
              <Typography sx={{ ...typo.body, color: ink.mid, mt: 0.75, minHeight: 42 }}><Hl text={m.gives} q={q} /></Typography>
              <Box sx={{ display: 'flex', gap: 1, mt: 1.5, ...typo.caption, color: ink.mid, flexWrap: 'wrap' }}>
                {m.status === 'ready' ? <span>включён у {enabledIn(m).length} из {active.length} отелей</span> : <span>включить пока нельзя</span>}
                {m.needs ? <span>· нужен {CONNECTION_TITLE[m.needs]}</span> : null}
              </Box>
            </ButtonBase>
          ))}
        </Box>
      ) : null}

      {view === 'list' && shown.length ? (
        <Box sx={{ ...panelSx, p: 0 }}>
          {shown.map((m, i) => (
            <ButtonBase
              key={m.code}
              onClick={() => go({ module: m.code })}
              sx={{ display: 'flex', width: '100%', gap: 1.5, alignItems: 'center', textAlign: 'left', px: 2, py: 1.5, borderTop: i ? `1px solid ${surface.hair}` : 'none' }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ ...typo.body, fontWeight: 700, color: ink.hi }}><Hl text={m.title} q={q} /></Box>
                <Box sx={{ ...typo.caption, color: ink.mid }}><Hl text={m.gives} q={q} /></Box>
              </Box>
              <Box sx={{ ...typo.caption, color: ink.mid, display: { xs: 'none', sm: 'block' }, whiteSpace: 'nowrap' }}>
                {m.status === 'ready' ? `у ${enabledIn(m).length} ${plural(enabledIn(m).length, 'отеля', 'отелей', 'отелей')}` : ''}
              </Box>
              {m.status === 'ready' ? <Pill tone="ok">работает</Pill> : <DevTag />}
            </ButtonBase>
          ))}
        </Box>
      ) : null}

      {view === 'table' && shown.length ? (
        <Box sx={{ ...panelSx, p: 0, overflowX: 'auto' }}>
          <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', ...typo.body, '& td, & th': { px: 1.5, py: 1.1, borderBottom: `1px solid ${surface.hair}`, textAlign: 'left', whiteSpace: 'nowrap' } }}>
            <Box component="thead">
              <Box component="tr" sx={{ '& th': { ...typo.label, color: ink.mid } }}>
                <th>Модуль</th>
                <th>Состояние</th>
                <th>Нужно подключение</th>
                {active.map((l) => <th key={l.row.id}>{l.profile?.name ?? l.row.subdomain}</th>)}
              </Box>
            </Box>
            <Box component="tbody">
              {shown.map((m) => (
                <Box component="tr" key={m.code} onClick={() => go({ module: m.code })} sx={{ cursor: 'pointer', '&:hover': { bgcolor: surface.s2 } }}>
                  <Box component="td" sx={{ fontWeight: 700, color: ink.hi }}><Hl text={m.title} q={q} /></Box>
                  <td>{m.status === 'ready' ? <Pill tone="ok">работает</Pill> : <DevTag />}</td>
                  <Box component="td" sx={{ color: ink.mid }}>{m.needs ? CONNECTION_TITLE[m.needs] : '—'}</Box>
                  {active.map((l) => {
                    const on = l.modules.some((x) => x.code === m.code && x.is_enabled);
                    return (
                      <Box component="td" key={l.row.id} sx={{ color: on && m.status === 'ready' ? accent.soft : ink.low, fontWeight: on ? 700 : 400 }}>
                        {on ? (m.status === 'ready' ? 'включён' : 'включён*') : '—'}
                      </Box>
                    );
                  })}
                </Box>
              ))}
            </Box>
          </Box>
          <Typography sx={{ ...typo.caption, color: ink.low, px: 1.5, py: 1 }}>
            * включён в старой консоли, но модуль ещё в разработке и ничего не делает — при переходе выключится, запись уйдёт в историю отеля
          </Typography>
        </Box>
      ) : null}
    </Box>
  );
}

function ModulePage({ module: m, lines, go }: { module: CatalogModule; lines: HotelLine[]; go: Go }) {
  const { q, values } = useFilters(['on'], 'hq');
  const journal = useQuery({ queryKey: ['sandbox', 'modules-journal'], queryFn: () => getAudit({ action: 'platform.hotel.modules_set', limit: 50 }) });
  const rows = journal.data?.items ?? [];
  const isOn = (l: HotelLine) => l.modules.some((x) => x.code === m.code && x.is_enabled);
  const ql = q.toLowerCase();
  const hotels = lines.filter(
    (l) => passes(values.on, isOn(l) ? 'on' : 'off') && (!ql || `${l.profile?.name ?? l.row.name} ${l.row.subdomain}`.toLowerCase().includes(ql)),
  );

  return (
    <Box>
      <Button size="small" sx={{ color: accent.soft, mb: 1, px: 0.5 }} onClick={() => go({ module: null, hq: null, on: null })}>← Все модули</Button>
      <PageHead title={m.title} subtitle={m.gives} actions={m.status === 'ready' ? <Pill tone="ok">работает</Pill> : <DevTag />} />
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, alignItems: 'start' }}>
        <Box sx={{ display: 'grid', gap: 2 }}>
          <Panel title="Что открывает">
            {m.opens.map((line) => (
              <Box key={line} sx={{ ...typo.body, color: ink.hi, py: 0.4 }}>• {line}</Box>
            ))}
            {m.needs ? (
              <Box sx={{ ...typo.caption, color: ink.mid, mt: 1 }}>
                Без подключения «{CONNECTION_TITLE[m.needs]}» модуль у отеля не работает — обзор отеля покажет это проблемой.
              </Box>
            ) : null}
          </Panel>
          <Panel
            title="Настройки по умолчанию"
            aside={m.status === 'ready' ? <Button size="small" sx={secondaryButtonSx}>Изменить</Button> : undefined}
          >
            {m.defaults.length ? (
              m.defaults.map(([label, value]) => (
                <KV key={label} label={label} help="Это значение получит отель, у которого модуль включат впервые. У отдельного отеля его можно поменять в карточке отеля.">
                  {value}
                </KV>
              ))
            ) : (
              <Empty title="Настроек пока нет">Они появятся вместе с модулем — тогда их можно будет задать здесь для всех новых включений.</Empty>
            )}
          </Panel>
        </Box>
        <Box sx={{ display: 'grid', gap: 2 }}>
          <Panel
            title="Отели"
            aside={
              <Box sx={{ ...typo.caption, color: ink.low, display: 'inline-flex', alignItems: 'center' }}>
                включён у {lines.filter(isOn).length} из {lines.length}
                <Help>Выключатель включает модуль у одного отеля. Чтобы включить сразу многим — выберите их в списке «Отели» и нажмите «Включить модуль…».</Help>
              </Box>
            }
          >
            <FilterBar
              go={go}
              searchKey="hq"
              placeholder="Найти отель"
              facets={[{ key: 'on', label: 'Модуль', options: [{ value: 'on', label: 'включён', tone: 'ok' }, { value: 'off', label: 'выключен', tone: 'muted' }] }]}
            />
            {!hotels.length ? <Empty title="Нет таких отелей">Уберите фильтр или измените поиск.</Empty> : null}
            {hotels.map((l) => {
              const on = isOn(l);
              return (
                <Box key={l.row.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.75, borderBottom: `1px solid ${surface.hair}` }}>
                  <ButtonBase
                    onClick={() => go({ s: 'hotels', module: null, view: null, hq: null, on: null, hotel: l.row.id, tab: 'modules' })}
                    sx={{ flex: 1, minWidth: 0, justifyContent: 'flex-start', textAlign: 'left' }}
                  >
                    <Box>
                      <Box sx={{ ...typo.body, fontWeight: 700, color: ink.hi }}><Hl text={l.profile?.name ?? l.row.name} q={q} /></Box>
                      <Box sx={{ ...typo.caption, color: ink.mid }}><Hl text={l.row.subdomain} q={q} /></Box>
                    </Box>
                  </ButtonBase>
                  {m.status === 'ready' ? (
                    <Toggle checked={on} label={`${m.title}: ${l.row.subdomain}`} />
                  ) : on ? (
                    <Pill tone="warn">был включён — выключится</Pill>
                  ) : (
                    <Box sx={{ ...typo.caption, color: ink.low }}>—</Box>
                  )}
                </Box>
              );
            })}
          </Panel>
          <Panel title="Журнал включений" aside={<Help>Кто и когда включал или выключал этот модуль у отелей. Полная история — во вкладке «История» отеля.</Help>}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1, ...typo.caption, color: ink.mid }}>
              <Sample /> сейчас журнал пишет только «изменён набор модулей», без названия модуля
            </Box>
            {rows.slice(0, 6).map((row) => (
              <Box key={row.id} sx={{ py: 0.75, borderBottom: `1px solid ${surface.hair}` }}>
                <Box sx={{ ...typo.caption, color: ink.low }}>{dateTime(row.at)} · {row.actor}</Box>
                <Box sx={{ ...typo.body, color: ink.hi }}>{row.hotel ?? row.subdomain}: включён</Box>
              </Box>
            ))}
            {!rows.length ? <Empty title="Включений ещё не было">Когда модуль включат или выключат у отеля, запись появится здесь.</Empty> : null}
          </Panel>
        </Box>
      </Box>
    </Box>
  );
}
