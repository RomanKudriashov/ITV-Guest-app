import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { QueryState } from '@/components/QueryState';
import { ink, panelSx, typo } from '../adminTokens';
import { useRights } from '../useRights';
import {
  getGroups,
  getPublication,
  getPublications,
  previewPublication,
  startPublication,
  type PublicationJob,
  type PublicationTarget,
} from '../adminClient';

/**
 * ПУБЛИКАЦИЯ — экран платформы.
 *
 * Четыре вещи по порядку работы: что публикуем, кому, предпросмотр, запуск.
 * Дальше — ход операции и отчёт.
 *
 * ХОД ОБНОВЛЯЕТСЯ САМ, пока операция идёт, и перестаёт, когда закончилась.
 * Опрос без остановки — это лишний запрос каждые две секунды навсегда; человек
 * при этом смотрит на завершённый отчёт и обновлять там нечего.
 *
 * ЧЕТЫРЕ ИСХОДА РАЗДЕЛЬНО. Отказ и ошибка — РАЗНЫЕ НОВОСТИ: отказ это ответ
 * отеля («нет модуля», «не тот тариф»), с ним идут к нему; ошибка — наша
 * поломка, с ней идут к нам. Сложенные в одно число, они означали бы «что-то
 * где-то не вышло» — то есть ничего.
 *
 * ПРАВО ВИДНО НА ЭКРАНЕ. Наблюдатель не получает даже предпросмотра: смотреть,
 * к скольким отелям применилось бы то, чего он не может запустить, незачем, а
 * форма с мёртвой кнопкой обещает работу, которой не будет.
 */
export function PublicationsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { canWrite, isOwner, isLoading } = useRights();

  const [form, setForm] = useState({
    preset: '',
    label: '',
    color: 'accent',
    scope: 'group' as PublicationTarget['scope'],
    groupId: '',
  });
  const [openJob, setOpenJob] = useState<string | null>(null);

  const groups = useQuery({ queryKey: ['admin', 'groups'], queryFn: getGroups, enabled: canWrite });
  const history = useQuery({ queryKey: ['admin', 'publications'], queryFn: getPublications });

  const target = (): PublicationTarget => ({
    kind: 'badge',
    payload: {
      preset: form.preset.trim(),
      label: { ru: form.label.trim() },
      color_role: form.color,
    },
    scope: form.scope,
    group_id: form.scope === 'group' ? form.groupId : null,
    hotel_ids: [],
  });

  const preview = useMutation({ mutationFn: () => previewPublication(target()) });
  const start = useMutation({
    mutationFn: () => startPublication(target()),
    onSuccess: (job) => {
      preview.reset();
      setOpenJob(job.id);
      void qc.invalidateQueries({ queryKey: ['admin', 'publications'] });
    },
  });

  const ready = form.preset.trim() && form.label.trim() && (form.scope !== 'group' || form.groupId);

  if (isLoading) return null;

  if (!canWrite) {
    // Наблюдателю — объяснение, а не форма с мёртвой кнопкой.
    return (
      <Box data-testid="admin-publications">
        <Typography sx={typo.pageTitle}>{t('admin.publications.title')}</Typography>
        <Alert severity="info" sx={{ mt: 2 }} data-testid="admin-publications-readonly">
          {t('admin.publications.readOnly')}
        </Alert>
        <History history={history} openJob={openJob} onOpen={setOpenJob} />
      </Box>
    );
  }

  return (
    <Box data-testid="admin-publications">
      <Typography sx={typo.pageTitle}>{t('admin.publications.title')}</Typography>
      <Typography sx={{ ...typo.caption, color: ink.low, mb: 2 }}>
        {t('admin.publications.subtitle')}
      </Typography>

      <Box sx={{ ...panelSx, p: 2, mb: 3 }}>
        <Stack spacing={2} sx={{ maxWidth: 640 }}>
          <Typography sx={typo.panelTitle}>{t('admin.publications.what')}</Typography>
          <Stack direction="row" spacing={1.5}>
            <TextField
              size="small"
              label={t('admin.publications.preset')}
              value={form.preset}
              onChange={(e) => setForm({ ...form, preset: e.target.value })}
              inputProps={{ 'data-testid': 'admin-pub-preset' }}
              helperText={t('admin.publications.presetHint')}
            />
            <TextField
              size="small"
              fullWidth
              label={t('admin.publications.label')}
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              inputProps={{ 'data-testid': 'admin-pub-label' }}
            />
          </Stack>

          <Typography sx={typo.panelTitle}>{t('admin.publications.whom')}</Typography>
          <Stack direction="row" spacing={1.5}>
            <TextField
              select
              size="small"
              sx={{ minWidth: 200 }}
              label={t('admin.publications.scope')}
              value={form.scope}
              onChange={(e) => {
                preview.reset();
                setForm({ ...form, scope: e.target.value as PublicationTarget['scope'] });
              }}
              SelectProps={{ SelectDisplayProps: { 'data-testid': 'admin-pub-scope' } as never }}
            >
              <MenuItem value="group">{t('admin.publications.scopes.group')}</MenuItem>
              {/*
                ВЕС ДЕЙСТВИЯ ВИДЕН. Весь флот — владельческое право, и поддержке
                этот пункт показывается недоступным с причиной, а не исчезает:
                пропавший пункт читается как «такой возможности нет».
              */}
              <MenuItem value="all" disabled={!isOwner} data-testid="admin-pub-scope-all">
                {t('admin.publications.scopes.all')}
                {!isOwner ? ` — ${t('admin.publications.ownerOnly')}` : ''}
              </MenuItem>
            </TextField>

            {form.scope === 'group' ? (
              <TextField
                select
                size="small"
                sx={{ minWidth: 220 }}
                label={t('admin.publications.group')}
                value={form.groupId}
                onChange={(e) => {
                  preview.reset();
                  setForm({ ...form, groupId: e.target.value });
                }}
                SelectProps={{ SelectDisplayProps: { 'data-testid': 'admin-pub-group' } as never }}
              >
                {(groups.data?.items ?? []).map((group) => (
                  <MenuItem key={group.id} value={group.id}>
                    {group.title}
                    {group.size !== undefined ? ` · ${group.size}` : ''}
                  </MenuItem>
                ))}
              </TextField>
            ) : null}
          </Stack>

          <Stack direction="row" spacing={1.5} alignItems="center">
            <Button
              variant="outlined"
              disabled={!ready || preview.isPending}
              onClick={() => preview.mutate()}
              data-testid="admin-pub-preview"
            >
              {t('admin.publications.preview')}
            </Button>
            {/*
              ЗАПУСК ТОЛЬКО ПОСЛЕ ПРЕДПРОСМОТРА. Число «применится к 47» — это
              последняя возможность заметить, что цель не та; кнопка, доступная
              до него, делает предпросмотр необязательным, то есть бесполезным.
            */}
            <Button
              variant="contained"
              disabled={!preview.data || start.isPending}
              onClick={() => start.mutate()}
              data-testid="admin-pub-start"
            >
              {t('admin.publications.start')}
            </Button>
            {preview.data ? (
              <Typography sx={{ ...typo.caption, color: ink.hi }} data-testid="admin-pub-count">
                {t('admin.publications.willApply', { count: preview.data.count })} ·{' '}
                {preview.data.sample.join(', ')}
                {preview.data.count > preview.data.sample.length ? '…' : ''}
              </Typography>
            ) : null}
          </Stack>

          {preview.isError || start.isError ? (
            <Alert severity="error" data-testid="admin-pub-error">
              {(preview.error ?? start.error) instanceof Error
                ? ((preview.error ?? start.error) as Error).message
                : t('errors.generic')}
            </Alert>
          ) : null}
        </Stack>
      </Box>

      {openJob ? <JobPanel jobId={openJob} /> : null}

      <History history={history} openJob={openJob} onOpen={setOpenJob} />
    </Box>
  );
}

/* ── Ход и отчёт ───────────────────────────────────────────────────────── */

const OUTCOMES = ['applied', 'skipped', 'refused', 'failed'] as const;
const OUTCOME_COLOR: Record<string, 'success' | 'default' | 'warning' | 'error'> = {
  applied: 'success',
  skipped: 'default',
  // Отказ отеля — предупреждение, а не поломка: с ним идут к отелю.
  refused: 'warning',
  // Ошибка — наша, и цвет у неё тот же, что у всего сломанного.
  failed: 'error',
};

function JobPanel({ jobId }: { jobId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<string | null>(null);

  const job = useQuery({
    queryKey: ['admin', 'publications', jobId],
    queryFn: () => getPublication(jobId),
    // ОПРОС ТОЛЬКО ПОКА ИДЁТ. Завершённый отчёт не меняется, и опрашивать его
    // вечно значит слать запрос каждые две секунды в пустоту.
    refetchInterval: (query) =>
      query.state.data && ['done', 'failed'].includes(query.state.data.status) ? false : 2000,
  });

  return (
    <Box sx={{ ...panelSx, p: 2, mb: 3 }} data-testid="admin-pub-job">
      <QueryState query={job} what={t('admin.publications.title')}>
        {(data) => (
          <>
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}>
              <Typography sx={typo.panelTitle}>{data.description}</Typography>
              <Chip
                size="small"
                label={t(`admin.publications.status.${data.status}`)}
                color={data.status === 'done' ? 'success' : 'info'}
                data-testid="admin-pub-status"
              />
            </Stack>

            {data.status === 'running' || data.status === 'pending' ? (
              <Box sx={{ mb: 1.5 }} data-testid="admin-pub-progress">
                {/*
                  ХОД — ЧИСЛОМ, а не крутилкой: «отчиталось 12 из 47» отвечает
                  на «сколько осталось», а вертящийся кружок — нет.
                */}
                <Typography sx={{ ...typo.caption, color: ink.mid, mb: 0.5 }}>
                  {t('admin.publications.progress', {
                    done: data.planned - data.pending,
                    total: data.planned,
                  })}
                </Typography>
                <LinearProgress
                  variant="determinate"
                  value={data.planned ? ((data.planned - data.pending) / data.planned) * 100 : 0}
                />
              </Box>
            ) : null}

            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
              {OUTCOMES.map((outcome) =>
                data.counts[outcome] ? (
                  <Chip
                    key={outcome}
                    size="small"
                    color={OUTCOME_COLOR[outcome]}
                    variant={outcome === 'skipped' ? 'outlined' : 'filled'}
                    label={`${t(`admin.publications.outcomes.${outcome}`)}: ${data.counts[outcome]}`}
                    onClick={() => setOpen(open === outcome ? null : outcome)}
                    data-testid={`admin-pub-outcome-${outcome}`}
                  />
                ) : null,
              )}
            </Stack>

            {OUTCOMES.map((outcome) => (
              <Collapse key={outcome} in={open === outcome} unmountOnExit>
                <Stack spacing={0.5} sx={{ py: 1 }} data-testid={`admin-pub-list-${outcome}`}>
                  {(data.results ?? [])
                    .filter((row) => row.outcome === outcome)
                    .map((row) => (
                      <Typography
                        key={row.hotel_id}
                        sx={{ ...typo.caption, color: ink.mid }}
                        data-testid={`admin-pub-row-${row.subdomain}`}
                      >
                        <b>{row.subdomain}</b>
                        {row.detail ? ` · ${row.detail}` : ''}
                      </Typography>
                    ))}
                </Stack>
              </Collapse>
            ))}

            <LocalEdits job={data} />
          </>
        )}
      </QueryState>
    </Box>
  );
}

/**
 * Пропущенные ИЗ-ЗА ЛОКАЛЬНОЙ ПРАВКИ — отдельным списком.
 *
 * Внутри «пропущено» лежат две разные новости: «у отеля уже то же самое»
 * (ничего не случилось) и «у отеля своя правка» (расхождение, с которым
 * платформа что-то делает). Различаем по коду причины, а не по тексту детали.
 */
function LocalEdits({ job }: { job: PublicationJob }) {
  const { t } = useTranslation();
  const rows = (job.results ?? []).filter((row) => row.reason === 'local_edit');
  if (!rows.length) return null;

  return (
    <Box sx={{ mt: 2, pt: 1.5, borderTop: '1px solid', borderColor: 'divider' }} data-testid="admin-pub-local-edits">
      <Typography sx={{ ...typo.caption, color: ink.hi, fontWeight: 700 }}>
        {t('admin.publications.localEdits', { count: rows.length })}
      </Typography>
      <Typography sx={{ ...typo.caption, color: ink.low, mb: 1 }}>
        {t('admin.publications.localEditsHint')}
      </Typography>
      <Stack spacing={0.5}>
        {rows.map((row) => (
          <Typography key={row.hotel_id} sx={{ ...typo.caption, color: ink.mid }}>
            {row.subdomain} · {row.detail}
          </Typography>
        ))}
      </Stack>
      {/* Расхождения мы уже умеем показывать — отсюда переход туда. */}
      <Button size="small" href="/admin?section=templates" data-testid="admin-pub-to-divergence">
        {t('admin.publications.toDivergence')}
      </Button>
    </Box>
  );
}

/* ── История ───────────────────────────────────────────────────────────── */

function History({
  history,
  openJob,
  onOpen,
}: {
  history: ReturnType<typeof useQuery<{ items: PublicationJob[] }>>;
  openJob: string | null;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <Box sx={{ ...panelSx, overflow: 'hidden' }} data-testid="admin-pub-history">
      <Typography sx={{ ...typo.panelTitle, p: 2, pb: 1 }}>
        {t('admin.publications.history')}
      </Typography>
      <QueryState query={history} what={t('admin.publications.history')}>
        {(data) =>
          data.items.length === 0 ? (
            <Typography sx={{ ...typo.caption, color: ink.low, p: 2, pt: 0 }}>
              {t('admin.publications.historyEmpty')}
            </Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('admin.publications.what')}</TableCell>
                  <TableCell>{t('admin.publications.whom')}</TableCell>
                  <TableCell>{t('admin.publications.when')}</TableCell>
                  <TableCell>{t('admin.publications.who')}</TableCell>
                  <TableCell>{t('admin.publications.result')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.items.map((job) => (
                  <TableRow
                    key={job.id}
                    hover
                    selected={job.id === openJob}
                    onClick={() => onOpen(job.id)}
                    sx={{ cursor: 'pointer' }}
                    data-testid={`admin-pub-history-${job.id}`}
                  >
                    <TableCell>{job.description}</TableCell>
                    <TableCell>
                      {job.scope === 'group'
                        ? job.group || t('admin.publications.scopes.group')
                        : t(`admin.publications.scopes.${job.scope}`)}
                    </TableCell>
                    <TableCell>{new Date(job.created_at).toLocaleString()}</TableCell>
                    <TableCell>{job.actor || '—'}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        {OUTCOMES.map((outcome) =>
                          job.counts[outcome] ? (
                            <Chip
                              key={outcome}
                              size="small"
                              color={OUTCOME_COLOR[outcome]}
                              variant={outcome === 'skipped' ? 'outlined' : 'filled'}
                              label={`${t(`admin.publications.outcomes.${outcome}`)}: ${job.counts[outcome]}`}
                            />
                          ) : null,
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
        }
      </QueryState>
    </Box>
  );
}
