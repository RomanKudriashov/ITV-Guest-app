import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import RefreshIcon from '@mui/icons-material/Refresh';

import { ApiError } from '@/api/client';
import {
  checkElement,
  fetchDiagnostics,
  fetchDiagnosticsFilterValues,
  fetchDiagnosticsLink,
  type CheckResult,
  type DiagnosticsRow,
  type GrmsType,
} from '@/api/grms';
import { useGrmsScope } from './scope';
import { queryKeys } from '@/api/queryKeys';
import { EmptyState } from '@/components/EmptyState';
import { useToast } from '@/components/ToastProvider';

/**
 * Диагностика инженера (ТЗ §14.3) и различение причин отказа (§6.8).
 *
 * Экран показывает ЗАПИСАННОЕ. Он не опрашивает оборудование при открытии и не
 * пересказывает журнал своими словами: столбцы — это поля записи, а сырой ответ
 * железа лежит под строкой как пришёл. Единственное вычисляемое поле — вид
 * элемента: в записи его нет, он добывается по слугу из текущей конфигурации и
 * потому у старых строк может быть пустым.
 *
 * Три звена связи стоят ОТДЕЛЬНО и порознь. Гостю всё это схлопывается в одну
 * нейтральную фразу — здесь наоборот: инженеру нужно знать, на каком звене
 * оборвалось, иначе он поедет проверять коннектор, у которого недоступен
 * endpoint. Технические причины живут только тут: экран под `/cms`, куда
 * гостевой токен не пускают в принципе.
 */

/** Исход обмена → цвет. Роли палитры, а не литералы: словарь цветов один. */
const RESULT_COLOR: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  confirmed: 'success',
  ok: 'success',
  accepted: 'warning',
  unconfirmed: 'warning',
  failed: 'error',
};

/** Состояние звена → цвет. `unknown` намеренно не красный: это не отказ. */
const LINK_COLOR: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  online: 'success',
  reachable: 'success',
  ok: 'success',
  unknown: 'default',
  offline: 'error',
  unreachable: 'error',
  unreadable: 'error',
};

const EMPTY_FILTERS = {
  room: '',
  element_kind: '',
  outcome: '',
  date_from: '',
  date_to: '',
};

export function DiagnosticsTab({ type }: { type: GrmsType }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  // База API — из области: CMS отеля или консоль платформы.
  const { transport } = useGrmsScope();
  const base = transport.base;

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [recheck, setRecheck] = useState<{ id: string; result: CheckResult } | null>(null);

  const link = useQuery({
    queryKey: queryKeys.grmsDiagnosticsLink(base),
    queryFn: () => fetchDiagnosticsLink(transport),
  });
  const values = useQuery({
    queryKey: queryKeys.grmsDiagnosticsFilters(base),
    queryFn: () => fetchDiagnosticsFilterValues(transport),
  });
  const journal = useQuery({
    queryKey: queryKeys.grmsDiagnostics(base, JSON.stringify(filters)),
    queryFn: () => fetchDiagnostics(transport, filters),
  });

  /*
    Повторное чтение идёт тем же путём, что и проверка на вкладке «Проверка»:
    без значения, то есть ТОЛЬКО чтение. Диагностика не должна переключать
    что-либо в занятом номере — инженер смотрит, а не хозяйничает.
  */
  const recheckMutation = useMutation({
    mutationFn: (row: DiagnosticsRow) =>
      checkElement(transport, type.code, {
        element_slug: row.element,
        room_number: row.room,
        value: null,
      }).then((result) => ({ id: row.id, result })),
    onSuccess: setRecheck,
    onError: (error) =>
      toast.show(error instanceof ApiError ? error.detail : t('errors.generic'), 'error'),
  });

  const formatAt = (value: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'medium' }).format(
      new Date(value),
    );

  if (journal.isError) {
    const error = journal.error;
    return (
      <Alert severity="error" data-testid="grms-diagnostics-error">
        {error instanceof ApiError ? error.detail : t('errors.generic')}
      </Alert>
    );
  }

  return (
    <Stack spacing={2} data-testid="grms-diagnostics">
      <LinkStatus link={link.data} loading={link.isLoading} formatAt={formatAt} />

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
            {t('roomControl.diagnostics.filtersTitle')}
          </Typography>
          <Stack direction="row" spacing={1.5} useFlexGap flexWrap="wrap">
            <TextField
              size="small"
              label={t('roomControl.diagnostics.room')}
              value={filters.room}
              onChange={(event) => setFilters({ ...filters, room: event.target.value })}
              inputProps={{ 'data-testid': 'diagnostics-filter-room' }}
              sx={{ minWidth: 140 }}
            />
            <TextField
              select
              size="small"
              label={t('roomControl.diagnostics.elementKind')}
              value={filters.element_kind}
              onChange={(event) => setFilters({ ...filters, element_kind: event.target.value })}
              SelectProps={{ SelectDisplayProps: { 'data-testid': 'diagnostics-filter-kind' } as never }}
              sx={{ minWidth: 200 }}
            >
              <MenuItem value="">{t('roomControl.diagnostics.anyKind')}</MenuItem>
              {(values.data?.element_kinds ?? []).map((kind) => (
                <MenuItem key={kind.code} value={kind.code}>
                  {kind.title}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label={t('roomControl.diagnostics.outcome')}
              value={filters.outcome}
              onChange={(event) => setFilters({ ...filters, outcome: event.target.value })}
              SelectProps={{
                SelectDisplayProps: { 'data-testid': 'diagnostics-filter-outcome' } as never,
              }}
              sx={{ minWidth: 200 }}
            >
              <MenuItem value="">{t('roomControl.diagnostics.anyOutcome')}</MenuItem>
              {(values.data?.outcomes ?? []).map((outcome) => (
                <MenuItem key={outcome} value={outcome}>
                  {t(`roomControl.diagnostics.results.${outcome}`, { defaultValue: outcome })}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              type="date"
              label={t('roomControl.diagnostics.dateFrom')}
              value={filters.date_from}
              onChange={(event) => setFilters({ ...filters, date_from: event.target.value })}
              InputLabelProps={{ shrink: true }}
              inputProps={{ 'data-testid': 'diagnostics-filter-from' }}
            />
            <TextField
              size="small"
              type="date"
              label={t('roomControl.diagnostics.dateTo')}
              value={filters.date_to}
              onChange={(event) => setFilters({ ...filters, date_to: event.target.value })}
              InputLabelProps={{ shrink: true }}
              inputProps={{ 'data-testid': 'diagnostics-filter-to' }}
            />
            <Button
              size="small"
              onClick={() => setFilters(EMPTY_FILTERS)}
              data-testid="diagnostics-filter-reset"
            >
              {t('roomControl.diagnostics.reset')}
            </Button>
          </Stack>
        </CardContent>
      </Card>

      {journal.isLoading ? <Skeleton variant="rounded" height={280} /> : null}

      {journal.data && journal.data.rows.length === 0 ? (
        <EmptyState
          title={t('roomControl.diagnostics.emptyTitle')}
          description={t('roomControl.diagnostics.emptyHint')}
        />
      ) : null}

      {journal.data && journal.data.rows.length > 0 ? (
        <Card variant="outlined">
          {/*
            Таблица уезжает вбок на своём контейнере, а не растягивает страницу:
            столбцов девять, и на планшете инженера они в ширину не помещаются.
          */}
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" data-testid="diagnostics-table">
              <TableHead>
                <TableRow>
                  <TableCell />
                  <TableCell>{t('roomControl.diagnostics.at')}</TableCell>
                  <TableCell>{t('roomControl.diagnostics.room')}</TableCell>
                  <TableCell>{t('roomControl.diagnostics.element')}</TableCell>
                  <TableCell>{t('roomControl.diagnostics.device')}</TableCell>
                  <TableCell>{t('roomControl.diagnostics.channel')}</TableCell>
                  <TableCell>{t('roomControl.diagnostics.sent')}</TableCell>
                  <TableCell>{t('roomControl.diagnostics.duration')}</TableCell>
                  <TableCell>{t('roomControl.diagnostics.result')}</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {journal.data.rows.map((row) => (
                  <JournalRow
                    key={row.id}
                    row={row}
                    expanded={expanded === row.id}
                    onToggle={() => setExpanded(expanded === row.id ? null : row.id)}
                    onRecheck={() => recheckMutation.mutate(row)}
                    rechecking={recheckMutation.isPending}
                    recheck={recheck?.id === row.id ? recheck.result : null}
                    formatAt={formatAt}
                  />
                ))}
              </TableBody>
            </Table>
          </Box>
        </Card>
      ) : null}

      {journal.data?.truncated ? (
        // Обрезанную выдачу говорим вслух: инженер, ищущий отказ трёхдневной
        // давности, должен знать, что смотрит не весь журнал.
        <Alert severity="info" data-testid="diagnostics-truncated">
          {t('roomControl.diagnostics.truncated', { limit: journal.data.limit })}
        </Alert>
      ) : null}
    </Stack>
  );
}

/** Три звена связи порознь — ТЗ §14 «статусы отображаются отдельно». */
function LinkStatus({
  link,
  loading,
  formatAt,
}: {
  link?: Awaited<ReturnType<typeof fetchDiagnosticsLink>>;
  loading: boolean;
  formatAt: (value: string) => string;
}) {
  const { t } = useTranslation();
  if (loading) return <Skeleton variant="rounded" height={96} />;
  if (!link) return null;

  const parts = [
    {
      key: 'connector',
      state: link.connector.state,
      detail: link.connector.name
        ? `${link.connector.name}${link.connector.version ? ` · ${link.connector.version}` : ''}`
        : '',
      at: link.connector.last_seen_at,
    },
    { key: 'endpoint', state: link.iridi_endpoint.state, detail: '', at: null },
    {
      key: 'readable',
      state: link.state_readable.state,
      detail: link.state_readable.reason_label || link.state_readable.reason,
      at: link.state_readable.at,
    },
  ];

  return (
    <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap" data-testid="diagnostics-link">
      {parts.map((part) => (
        <Card key={part.key} variant="outlined" sx={{ flex: '1 1 220px', minWidth: 220 }}>
          <CardContent>
            <Typography variant="caption" color="text.secondary">
              {t(`roomControl.diagnostics.link.${part.key}`)}
            </Typography>
            <Box sx={{ mt: 0.5 }}>
              <Chip
                size="small"
                color={LINK_COLOR[part.state] ?? 'default'}
                label={t(`roomControl.diagnostics.states.${part.state}`, {
                  defaultValue: part.state,
                })}
                data-testid={`diagnostics-link-${part.key}`}
              />
            </Box>
            {part.detail ? (
              <Typography variant="body2" sx={{ mt: 0.75 }}>
                {part.detail}
              </Typography>
            ) : null}
            {part.at ? (
              <Typography variant="caption" color="text.secondary">
                {formatAt(part.at)}
              </Typography>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </Stack>
  );
}

function JournalRow({
  row,
  expanded,
  onToggle,
  onRecheck,
  rechecking,
  recheck,
  formatAt,
}: {
  row: DiagnosticsRow;
  expanded: boolean;
  onToggle: () => void;
  onRecheck: () => void;
  rechecking: boolean;
  recheck: CheckResult | null;
  formatAt: (value: string) => string;
}) {
  const { t } = useTranslation();
  const channel = [row.command, row.feedback].filter(Boolean).join(' → ');

  return (
    <>
      <TableRow hover data-testid={`diagnostics-row-${row.id}`}>
        <TableCell padding="none">
          <IconButton size="small" onClick={onToggle} aria-label={t('roomControl.diagnostics.details')}>
            <ExpandMoreIcon
              fontSize="small"
              sx={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: '.15s' }}
            />
          </IconButton>
        </TableCell>
        <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatAt(row.at)}</TableCell>
        <TableCell data-testid="diagnostics-cell-room">{row.room || '—'}</TableCell>
        <TableCell>
          {row.element || '—'}
          {row.element_kind ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              {row.element_kind}
            </Typography>
          ) : null}
        </TableCell>
        <TableCell>{row.device || '—'}</TableCell>
        <TableCell>{channel || '—'}</TableCell>
        <TableCell>{row.sent ?? '—'}</TableCell>
        <TableCell>{row.duration_ms == null ? '—' : `${row.duration_ms} ms`}</TableCell>
        <TableCell>
          <Chip
            size="small"
            color={RESULT_COLOR[row.result] ?? 'default'}
            label={t(`roomControl.diagnostics.results.${row.result}`, { defaultValue: row.result })}
            data-testid="diagnostics-cell-result"
          />
          {row.reason ? (
            // Причина словами требования, а код — рядом и мелко: инженеру нужны
            // оба, слова для понимания и код для поиска в журнале коннектора.
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', mt: 0.25 }}
              data-testid="diagnostics-cell-reason"
            >
              {row.reason_label || row.reason}
            </Typography>
          ) : null}
        </TableCell>
        <TableCell padding="none">
          <IconButton
            size="small"
            onClick={onRecheck}
            disabled={rechecking || !row.element || !row.room}
            title={
              row.element && row.room
                ? t('roomControl.diagnostics.recheck')
                : t('roomControl.diagnostics.recheckImpossible')
            }
            data-testid="diagnostics-recheck"
          >
            <RefreshIcon fontSize="small" />
          </IconButton>
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={10} sx={{ py: 0, border: 0 }}>
          <Collapse in={expanded} unmountOnExit>
            <Box sx={{ py: 1.5 }} data-testid="diagnostics-details">
              <Stack spacing={0.75}>
                <Detail label={t('roomControl.diagnostics.requestId')} value={row.request_id} />
                <Detail label={t('roomControl.diagnostics.observed')} value={row.observed} />
                {row.reason ? (
                  <Detail label={t('roomControl.diagnostics.reasonCode')} value={row.reason} />
                ) : null}
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    {t('roomControl.diagnostics.rawResponse')}
                  </Typography>
                  {/*
                    Сырой ответ КАК ПРИШЁЛ, без разбора и подсветки: iRidi умеет
                    вернуть невалидный JSON, и именно это инженеру и надо видеть.
                  */}
                  <Box
                    component="pre"
                    data-testid="diagnostics-raw"
                    sx={{
                      m: 0,
                      mt: 0.25,
                      p: 1,
                      overflowX: 'auto',
                      fontSize: '0.75rem',
                      bgcolor: 'action.hover',
                      borderRadius: 1,
                    }}
                  >
                    {row.raw_response || '—'}
                  </Box>
                </Box>
                {recheck ? (
                  <Alert
                    severity={recheck.outcome === 'failed' ? 'error' : 'success'}
                    data-testid="diagnostics-recheck-result"
                    sx={{ mt: 1 }}
                  >
                    {/*
                      Исход повторного чтения показывается ЧЕСТНО, включая «не
                      удалось»: диагностика, которая молчит про собственный
                      промах, бесполезна вдвойне.
                    */}
                    {t(`roomControl.check.${recheck.outcome}`, { defaultValue: recheck.outcome })}
                    {recheck.note ? ` — ${recheck.note}` : ''}
                  </Alert>
                ) : null}
              </Stack>
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}

function Detail({ label, value }: { label: string; value: unknown }) {
  return (
    <Box sx={{ display: 'flex', gap: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 140 }}>
        {label}
      </Typography>
      <Typography variant="caption">{value === null || value === '' ? '—' : String(value)}</Typography>
    </Box>
  );
}
