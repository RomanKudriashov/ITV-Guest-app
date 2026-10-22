import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { ListEmpty } from '@/kit/list/ListEmpty';
import { useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { ink, panelSx, typo } from '../adminTokens';
import { QueryState } from '@/components/QueryState';
import { getAudit, getAuditActions, getAuditPeople, getGroups, getHotelsView } from '../adminClient';
import { SupportSessionsPage } from './SupportSessionsPage';
import { FilterBar, ViewSwitch, type Facet } from './hotels/hotelsUi';
import { JournalRow, PERIODS } from './journalUi';

/**
 * Аудит платформы — один список, а не разрез по отелям.
 *
 * Вопрос, который задают этому экрану, звучит «кто что делал», и ответ на него
 * не должен требовать сначала выбрать отель. Действия без отеля (вход, 2FA,
 * команда) и действия над отелями лежат вперемешку по времени — именно так их
 * и разбирают.
 *
 * ГЛУБИНА И ПОИСК. Экран отдавал последние 150 записей и на этом заканчивался:
 * на пятидесяти тысячах записей вчерашний инцидент был недостижим — до него
 * нельзя долистать, а найти было нечем. Теперь листание курсором и три
 * фильтра: дата, отель, действие.
 *
 * Курсор, а не страницы по номеру: журнал пополняется прямо во время
 * просмотра, и при смещении вторая страница показала бы часть первой,
 * пропустив столько же — как раз там и оказался бы искомый случай.
 */
/**
 * ЖУРНАЛ ДЕЙСТВИЙ (партия 62-B): все действия — и, отдельным видом, входы
 * поддержки в панели отелей (раздел «Сессии поддержки» ушёл из меню). Вид —
 * в адресе (`view=support`): ссылка открывает тот же.
 */
export function AuditPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const view: 'all' | 'support' = params.get('view') === 'support' ? 'support' : 'all';
  const setView = (next: 'all' | 'support') => {
    const out = new URLSearchParams();
    out.set('section', 'audit');
    if (next === 'support') out.set('view', 'support');
    setParams(out);
  };
  return (
    <Box data-testid="admin-audit-page">
      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ flex: '1 1 320px', minWidth: 0 }}>
          <Typography sx={{ ...typo.pageTitle, color: ink.hi }}>{t('admin.audit.title')}</Typography>
          <Typography sx={{ ...typo.caption, color: ink.mid, mt: 0.5 }}>
            {view === 'support' ? t('admin.support.subtitle') : t('admin.audit.subtitle')}
          </Typography>
        </Box>
        <ViewSwitch
          label={t('admin.audit.viewLabel')}
          value={view}
          onChange={setView}
          testIdPrefix="admin-audit-view"
          options={[
            ['all', t('admin.audit.viewAll')],
            ['support', t('admin.audit.viewSupport')],
          ]}
        />
      </Box>
      {view === 'support' ? <SupportSessionsPage embedded /> : <AuditLog />}
    </Box>
  );
}

const FILTER_KEYS = ['who', 'action', 'hotels', 'group', 'period', 'search'] as const;

/**
 * Лента журнала (партия 62-D): кто, действие, отель, группа, период, текст —
 * чипами, в адресе, фильтрует сервер. Листание — курсором (он про место в
 * ленте, а не про выборку, поэтому в адрес не кладётся).
 */
function AuditLog() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const values = Object.fromEntries(FILTER_KEYS.map((key) => [key, params.get(key) ?? '']));
  const filterKey = JSON.stringify(values);
  // Стек курсоров: вперёд кладём, назад снимаем; смена фильтра — с начала.
  const [cursors, setCursors] = useState<{ key: string; stack: string[] }>({ key: filterKey, stack: [] });
  const stack = cursors.key === filterKey ? cursors.stack : [];

  const query = {
    who: values.who || null,
    action: values.action || null,
    hotel_id: values.hotels || null,
    group_id: values.group || null,
    period: values.period || null,
    search: values.search || null,
    cursor: stack[stack.length - 1] ?? null,
  };
  const audit = useQuery({ queryKey: ['admin', 'audit', query], queryFn: () => getAudit({ limit: 100, ...query }) });
  const actions = useQuery({ queryKey: ['admin', 'audit', 'actions'], queryFn: getAuditActions });
  const people = useQuery({ queryKey: ['admin', 'audit', 'people'], queryFn: getAuditPeople });
  const hotels = useQuery({ queryKey: ['admin', 'fleet', 'all', 'everything'], queryFn: () => getHotelsView({ layout: 'list', origin: 'all' }) });
  const groups = useQuery({ queryKey: ['admin', 'groups'], queryFn: getGroups });

  const facets: Facet[] = [
    { key: 'who', label: t('admin.history.who'), options: (Array.isArray(people.data) ? people.data : []).map((p) => ({ value: p.id ?? '', label: p.name })) },
    {
      key: 'action',
      label: t('admin.audit.filterAction'),
      options: (Array.isArray(actions.data) ? actions.data : []).map((code) => ({ value: code, label: t(`admin.action.${code}`, { defaultValue: code }) })),
      // Код из адреса, которого нет в списке видов, — словом, а не кодом.
      describe: (code) => t(`admin.action.${code}`, { defaultValue: t('admin.hotels.filter.unknownValue') }),
    },
    { key: 'hotels', label: t('admin.audit.filterHotel'), options: (hotels.data?.items ?? []).map((h) => ({ value: h.id, label: h.name })) },
    { key: 'group', label: t('admin.audit.filterGroup'), options: (groups.data?.items ?? []).map((g) => ({ value: g.id, label: g.title })) },
    { key: 'period', label: t('admin.history.period'), options: PERIODS.map((p) => ({ value: p, label: t(`admin.history.periods.${p}`) })) },
  ];
  const isFiltered = FILTER_KEYS.some((key) => values[key]);

  return (
    <Box data-testid="admin-audit" sx={{ mt: 2 }}>
      <FilterBar
        facets={facets}
        placeholder={t('admin.audit.search')}
        aside={
          audit.data ? (
            <Typography sx={{ color: ink.low, ...typo.caption }} data-testid="admin-audit-total">
              {t('admin.audit.counter', { shown: audit.data.items.length, total: audit.data.total })}
            </Typography>
          ) : null
        }
      />
      {/*
        Пустое состояние — общее на все списки: «ничего не найдено» просит
        снять фильтр, «пока пусто» — дождаться первой записи.
      */}
      <QueryState query={audit} what={t('state.what.audit')}>
        {(page) =>
          page.items.length === 0 ? (
            <ListEmpty isFiltered={isFiltered} onReset={() => undefined} what={t('state.what.audit')} />
          ) : (
            <>
              <Box sx={{ ...panelSx, py: 0.5 }}>
                {page.items.map((row) => (
                  <JournalRow
                    key={row.id}
                    entry={{ ...row, actor: row.actor_info }}
                    testId={`admin-audit-${row.action}`}
                    aside={
                      row.hotel ? (
                        <Box sx={{ ...typo.caption, color: ink.hi, fontWeight: 600, textAlign: { md: 'right' } }}>
                          {row.hotel}
                          <Box sx={{ color: ink.low, fontWeight: 400 }}>{row.subdomain}</Box>
                        </Box>
                      ) : null
                    }
                  />
                ))}
              </Box>
              <Box sx={{ display: 'flex', gap: 1, mt: 2, alignItems: 'center' }}>
                <Button
                  size="small"
                  disabled={stack.length === 0}
                  onClick={() => setCursors({ key: filterKey, stack: stack.slice(0, -1) })}
                  data-testid="admin-audit-prev"
                >
                  {t('admin.audit.prev')}
                </Button>
                <Button
                  size="small"
                  disabled={!page.next_cursor}
                  onClick={() => page.next_cursor && setCursors({ key: filterKey, stack: [...stack, page.next_cursor] })}
                  data-testid="admin-audit-next"
                >
                  {t('admin.audit.next')}
                </Button>
              </Box>
            </>
          )
        }
      </QueryState>
    </Box>
  );
}
