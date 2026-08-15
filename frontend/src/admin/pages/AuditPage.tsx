import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { accent, ink, panelSx, surface } from '../adminTokens';
import { QueryState } from '@/components/QueryState';
import { getAudit, getAuditActions, type AuditRow } from '../adminClient';

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
export function AuditPage() {
  const { t } = useTranslation();
  const [action, setAction] = useState('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [subdomain, setSubdomain] = useState('');
  // Стек курсоров: вперёд кладём, назад снимаем. Хранить «номер страницы»
  // здесь нечего — страниц с номерами у курсорного листания не бывает.
  const [cursors, setCursors] = useState<string[]>([]);

  const filters = {
    action: action || null,
    since: since ? `${since}T00:00:00` : null,
    until: until ? `${until}T23:59:59` : null,
    cursor: cursors[cursors.length - 1] ?? null,
  };

  const audit = useQuery({
    queryKey: ['admin', 'audit', filters],
    queryFn: () => getAudit({ limit: 100, ...filters }),
  });
  const actions = useQuery({ queryKey: ['admin', 'audit', 'actions'], queryFn: getAuditActions });

  const resetPaging = () => setCursors([]);
  const visible = (rows: AuditRow[]) =>
    subdomain ? rows.filter((row) => row.subdomain?.includes(subdomain)) : rows;

  return (
    <Box data-testid="admin-audit">
      <Typography sx={{ fontSize: 24, fontWeight: 800, letterSpacing: '-.02em' }}>
        {t('admin.audit.title')}
      </Typography>
      <Typography sx={{ color: ink.low, fontSize: 13, mt: 0.5 }}>
        {t('admin.audit.subtitle')}
      </Typography>

      <Box sx={{ ...panelSx, mt: 2, display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          select
          size="small"
          label={t('admin.audit.filterAction')}
          value={action}
          onChange={(event) => {
            setAction(event.target.value);
            resetPaging();
          }}
          SelectProps={{ inputProps: { 'data-testid': 'admin-audit-filter-action' } }}
          sx={{ minWidth: 220 }}
        >
          <MenuItem value="">{t('admin.audit.filterAny')}</MenuItem>
          {(actions.data ?? []).map((code) => (
            <MenuItem key={code} value={code}>
              {t(`admin.action.${code}`, { defaultValue: code })}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          type="date"
          label={t('admin.audit.filterSince')}
          value={since}
          onChange={(event) => {
            setSince(event.target.value);
            resetPaging();
          }}
          InputLabelProps={{ shrink: true }}
          inputProps={{ 'data-testid': 'admin-audit-filter-since' }}
        />
        <TextField
          size="small"
          type="date"
          label={t('admin.audit.filterUntil')}
          value={until}
          onChange={(event) => {
            setUntil(event.target.value);
            resetPaging();
          }}
          InputLabelProps={{ shrink: true }}
          inputProps={{ 'data-testid': 'admin-audit-filter-until' }}
        />
        <TextField
          size="small"
          label={t('admin.audit.filterHotel')}
          value={subdomain}
          onChange={(event) => setSubdomain(event.target.value)}
          inputProps={{ 'data-testid': 'admin-audit-filter-hotel' }}
          sx={{ minWidth: 180 }}
        />
        <Box sx={{ flexGrow: 1 }} />
        {audit.data ? (
          <Typography sx={{ color: ink.low, fontSize: 12.5 }} data-testid="admin-audit-total">
            {t('admin.audit.counter', {
              shown: visible(audit.data.items).length,
              total: audit.data.total,
            })}
          </Typography>
        ) : null}
      </Box>

      <QueryState
        query={audit}
        what={t('state.what.audit')}
        isEmpty={(page) => visible(page.items).length === 0}
        emptyText={t('admin.audit.empty')}
      >
        {(page) => (
          <>
            <Box sx={{ mt: 2.25 }}>
              {visible(page.items).map((row) => (
                <Box
                  key={row.id}
                  data-testid={`admin-audit-${row.action}`}
                  sx={{
                    display: 'flex',
                    gap: 1.5,
                    alignItems: 'baseline',
                    py: 1.1,
                    borderBottom: `1px solid ${surface.hair}`,
                    fontSize: 12.5,
                  }}
                >
                  <Typography sx={{ color: ink.low, fontSize: 12, minWidth: 140, flex: 'none' }}>
                    {new Date(row.at).toLocaleString()}
                  </Typography>
                  <Typography sx={{ color: accent.soft, fontSize: 12, minWidth: 180, flex: 'none' }}>
                    {row.actor}
                  </Typography>
                  <Typography sx={{ color: ink.mid, flexGrow: 1 }}>
                    {t(`admin.action.${row.action}`, { defaultValue: row.action })}
                  </Typography>
                  {row.hotel ? (
                    <Typography sx={{ color: ink.hi, fontSize: 12, fontWeight: 600 }}>
                      {row.hotel}
                    </Typography>
                  ) : null}
                </Box>
              ))}
            </Box>

            <Box sx={{ display: 'flex', gap: 1, mt: 2, alignItems: 'center' }}>
              <Button
                size="small"
                disabled={cursors.length === 0}
                onClick={() => setCursors((prev) => prev.slice(0, -1))}
                data-testid="admin-audit-prev"
              >
                {t('admin.audit.prev')}
              </Button>
              <Button
                size="small"
                disabled={!page.next_cursor}
                onClick={() =>
                  setCursors((prev) => (page.next_cursor ? [...prev, page.next_cursor] : prev))
                }
                data-testid="admin-audit-next"
              >
                {t('admin.audit.next')}
              </Button>
            </Box>
          </>
        )}
      </QueryState>
    </Box>
  );
}
