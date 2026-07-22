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

import { fetchExportJob, requestExport } from '@/api/analytics';
import type { AnalyticsQuery, ExportFormat, ExportJob } from '@/api/analyticsTypes';
import { queryKeys } from '@/api/queryKeys';
import { useToast } from '@/components/ToastProvider';

const FORMATS: ExportFormat[] = ['csv', 'xlsx'];

/**
 * Queues a heavy export of the current slice, then polls the job until it is
 * `ready` and triggers the download. Deliberately non-blocking: the rest of the
 * page stays usable while a spinner and status line report progress.
 */
export function ExportButton({ params }: { params: AnalyticsQuery }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const downloadedRef = useRef<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (format: ExportFormat) => requestExport(format, params),
    onSuccess: (job) => {
      downloadedRef.current = null;
      setJobId(job.id);
    },
    onError: () => toast.show(t('analytics.export.failed'), 'error'),
  });

  const poll = useQuery({
    queryKey: queryKeys.analyticsExport(jobId ?? 'none'),
    queryFn: () => fetchExportJob(jobId as string),
    enabled: Boolean(jobId),
    retry: 1,
    refetchInterval: (query) => {
      const status = (query.state.data as ExportJob | undefined)?.status;
      return status === 'ready' || status === 'failed' ? false : 1500;
    },
  });

  const job = poll.data;
  const pending = createMutation.isPending || job?.status === 'pending' || job?.status === 'running';

  // Fire the download exactly once when the file becomes available.
  useEffect(() => {
    if (job?.status === 'ready' && job.file && downloadedRef.current !== job.id) {
      downloadedRef.current = job.id;
      triggerDownload(job.file);
      toast.show(t('analytics.export.ready'), 'success');
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
    if (!job) return null;
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

function triggerDownload(url: string) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.rel = 'noopener';
  anchor.download = '';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}
