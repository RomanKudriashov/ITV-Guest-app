import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';

import { fetchExportFile, fetchExportJob, requestExport } from '@/api/analytics';
import type { AnalyticsQuery, ExportFormat, ExportJob } from '@/api/analyticsTypes';
import { queryKeys } from '@/api/queryKeys';
import { useToast } from '@/components/ToastProvider';

const FORMATS: ExportFormat[] = ['csv', 'xlsx'];

/**
 * Queues a heavy export of the current slice, then polls the job until it is
 * `ready` and triggers the download. Deliberately non-blocking: the rest of the
 * page stays usable while a spinner and status line report progress.
 */
/** Восемьдесят опросов по 1.5 с — две минуты. Дальше честнее сказать «не дождались». */
const EXPORT_MAX_POLLS = 80;

export function ExportButton({ params }: { params: AnalyticsQuery }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const downloadedRef = useRef<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (format: ExportFormat) => requestExport(format, params),
    onSuccess: (job) => {
      downloadedRef.current = null;
      setDownloadFailed(false);
      setJobId(job.id);
    },
    onError: () => toast.show(t('analytics.export.failed'), 'error'),
  });

  /*
    У «Готовим экспорт…» ЕСТЬ ПРЕДЕЛ.

    Опрос возвращал 1500 мс до состояния `ready`/`failed` — и только до них.
    Умер воркер, застрял джоб, потерялась задача в очереди — и надпись крутится
    вечно: обещание без срока перестаёт быть обещанием. Тот же дефект, что был
    на экране номера с «читаем состояние…».

    Две минуты: экспорт за период считается секундами, самый тяжёлый разрез на
    большом отеле — десятками. Восемьдесят опросов по 1.5 с покрывают это с
    запасом, а дальше честнее сказать «не дождались», чем крутить дальше.
  */
  const [polls, setPolls] = useState(0);
  const poll = useQuery({
    queryKey: queryKeys.analyticsExport(jobId ?? 'none'),
    queryFn: () => fetchExportJob(jobId as string),
    enabled: Boolean(jobId),
    retry: 1,
    refetchInterval: (query) => {
      const status = (query.state.data as ExportJob | undefined)?.status;
      if (status === 'ready' || status === 'failed') return false;
      if (query.state.dataUpdateCount + query.state.errorUpdateCount >= EXPORT_MAX_POLLS)
        return false;
      return 1500;
    },
  });

  // Считаем попытки эффектом, а не внутри `refetchInterval`: тот вызывается
  // и на перерисовках, и менять состояние из него — гонка. Сорванный запрос
  // тоже попытка: иначе лежащий бэкенд не приближал бы срок вовсе.
  useEffect(() => {
    if (poll.dataUpdatedAt || poll.errorUpdatedAt) setPolls((n) => n + 1);
  }, [poll.dataUpdatedAt, poll.errorUpdatedAt]);
  // Новый экспорт — новый ключ запроса и новый отсчёт.
  useEffect(() => {
    setPolls(0);
  }, [jobId]);

  const status = poll.data?.status;
  const timedOut =
    polls >= EXPORT_MAX_POLLS && status !== 'ready' && status !== 'failed';

  const job = poll.data;
  const pending = createMutation.isPending || job?.status === 'pending' || job?.status === 'running';

  // Fire the download exactly once when the file becomes available.
  useEffect(() => {
    if (job?.status === 'ready' && job.file && downloadedRef.current !== job.id) {
      downloadedRef.current = job.id;
      // Скачивание — запросом с токеном. Отказ виден отдельно от «готово»:
      // раньше тост «готово» показывался ДО скачивания, и сорванная загрузка
      // выглядела успехом.
      fetchExportFile(job.id, job.filename ?? 'analytics-export')
        .then(({ blob, filename }) => {
          saveBlob(blob, filename);
          toast.show(t('analytics.export.ready'), 'success');
        })
        .catch(() => {
          setDownloadFailed(true);
          toast.show(t('analytics.export.downloadFailed'), 'error');
        });
    }
    if (job?.status === 'failed' && downloadedRef.current !== job.id) {
      downloadedRef.current = job.id;
      toast.show(t('analytics.export.failed'), 'error');
    }
  }, [job, t, toast]);

  const start = (format: ExportFormat) => {
    setAnchorEl(null);
    createMutation.mutate(format);
  };

  const statusLabel = (): string | null => {
    if (createMutation.isPending) return t('analytics.export.queuing');
    // Срок вышел — говорим прямо, а не крутим «готовим» дальше.
    if (timedOut) return t('analytics.export.timedOut');
    if (!job) return null;
    // Срыв скачивания важнее «готово»: срез посчитан, но файла у оператора нет.
    if (downloadFailed) return t('analytics.export.downloadFailed');
    switch (job.status) {
      case 'pending':
      case 'running':
        return t('analytics.export.working');
      case 'ready':
        return t('analytics.export.readyShort', { count: job.row_count ?? 0 });
      case 'failed':
        return t('analytics.export.failed');
      default:
        return null;
    }
  };

  const label = statusLabel();

  return (
    <Stack direction="row" spacing={1} alignItems="center">
      {label ? (
        <Typography
          variant="caption"
          color={job?.status === 'failed' ? 'error.main' : 'text.secondary'}
          data-testid="analytics-export-status"
        >
          {label}
        </Typography>
      ) : null}
      <Button
        variant="outlined"
        size="small"
        startIcon={
          pending ? <CircularProgress size={16} color="inherit" /> : <FileDownloadOutlinedIcon />
        }
        onClick={(e) => setAnchorEl(e.currentTarget)}
        disabled={pending}
        data-testid="analytics-export-button"
      >
        {t('analytics.export.button')}
      </Button>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        {FORMATS.map((format) => (
          <MenuItem
            key={format}
            onClick={() => start(format)}
            data-testid={`analytics-export-format-${format}`}
          >
            {t(`analytics.export.formats.${format}`)}
          </MenuItem>
        ))}
      </Menu>
    </Stack>
  );
}

/** Отдать полученные байты браузеру под явным именем. */
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.rel = 'noopener';
  // Имя ЯВНОЕ. Пустой `download` отдавал имя на откуп ответу, а у отказа
  // заголовка нет — так и рождался «download.json».
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Освобождаем ссылку, но не раньше, чем браузер начнёт качать.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
