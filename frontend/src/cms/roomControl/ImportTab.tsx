import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';

import { ApiError } from '@/api/client';
import {
  confirmImport,
  previewImport,
  reconcileImport,
  type ImportPreview,
  type ReconcileResult,
} from '@/api/grms';
import { useGrmsScope } from './scope';
import { queryKeys } from '@/api/queryKeys';
import { useToast } from '@/components/ToastProvider';

/**
 * Импорт ПНР: разбор → сверка с живым оборудованием → подтверждение.
 *
 * Предпросмотр держится ЗДЕСЬ и уезжает на сервер целиком на каждом шаге.
 * Это не расточительство: администратор видит разобранное и отвечает за него,
 * а хранить полуразобранный файл на сервере между запросами значило бы завести
 * состояние, которое некому закрыть, если человек просто закроет вкладку.
 *
 * СВЕРКА НЕ БЛОКИРУЕТ. Коннектор офлайн — это состояние объекта, а не ошибка
 * импорта: отель настраивают до того, как подключат коробку.
 */
export function ImportTab({ onImported }: { onImported: () => void }) {
  const { t } = useTranslation();
  // База API — из области: CMS отеля или консоль платформы.
  const { transport } = useGrmsScope();
  const base = transport.base;
  const toast = useToast();
  const queryClient = useQueryClient();

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [reports, setReports] = useState<ReconcileResult | null>(null);
  const [replace, setReplace] = useState(false);

  const failure = (error: unknown) =>
    toast.show(error instanceof ApiError ? error.detail : t('errors.generic'), 'error');

  const previewMutation = useMutation({
    mutationFn: () => previewImport(transport, file as File),
    onSuccess: (data) => {
      setPreview(data);
      setReports(null);
    },
    onError: failure,
  });

  const reconcileMutation = useMutation({
    mutationFn: () => reconcileImport(transport, preview as ImportPreview),
    onSuccess: setReports,
    onError: failure,
  });

  const confirmMutation = useMutation({
    mutationFn: () => confirmImport(transport, preview as ImportPreview, replace),
    onSuccess: (saved) => {
      toast.show(t('roomControl.import.saved', { count: saved.types.length }), 'success');
      void queryClient.invalidateQueries({ queryKey: queryKeys.grmsTypes(base) });
      onImported();
    },
    onError: failure,
  });

  const variableCount = (preview?.types ?? []).reduce((sum, type) => sum + type.variables.length, 0);
  const roomCount = new Set((preview?.types ?? []).flatMap((type) => type.rooms)).size;

  return (
    <Stack spacing={2} data-testid="grms-import">
      <Card variant="outlined" sx={{ borderColor: 'divider' }}>
        <CardContent>
          <Typography variant="subtitle1">{t('roomControl.import.title')}</Typography>
          <Typography variant="caption" color="text.secondary">
            {t('roomControl.import.hint')}
          </Typography>
          <Divider sx={{ my: 1.5 }} />
          <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
            <Button component="label" variant="outlined" data-testid="grms-import-pick">
              {file ? file.name : t('roomControl.import.pickFile')}
              <input
                hidden
                type="file"
                accept=".xlsx"
                data-testid="grms-import-file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </Button>
            <Button
              variant="contained"
              disabled={!file || previewMutation.isPending}
              onClick={() => previewMutation.mutate()}
              data-testid="grms-import-preview"
            >
              {t('roomControl.import.preview')}
            </Button>
          </Stack>
        </CardContent>
      </Card>

      {preview && (
        <Card variant="outlined" sx={{ borderColor: 'divider' }} data-testid="grms-import-result">
          <CardContent>
            <Stack direction="row" spacing={1} sx={{ mb: 1.5 }} flexWrap="wrap" useFlexGap>
              <Chip
                label={`${t('roomControl.import.typesFound')}: ${preview.types.length}`}
                data-testid="grms-import-types-count"
              />
              <Chip label={`${t('roomControl.import.roomsFound')}: ${roomCount}`} />
              <Chip label={`${t('roomControl.import.variablesFound')}: ${variableCount}`} />
            </Stack>

            {preview.warnings.length > 0 && (
              <Alert severity="warning" sx={{ mb: 2 }} data-testid="grms-import-warnings">
                <AlertTitle>{t('roomControl.import.warnings')}</AlertTitle>
                <Stack component="ul" sx={{ m: 0, pl: 2 }}>
                  {preview.warnings.map((warning, index) => (
                    <li key={`${warning.code}-${index}`}>
                      {t(`roomControl.warning.${warning.code}`, { defaultValue: warning.message })}
                      {warning.where ? ` — ${warning.where}` : ''}
                    </li>
                  ))}
                </Stack>
              </Alert>
            )}

            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('roomControl.import.type')}</TableCell>
                  <TableCell>{t('roomControl.import.reference')}</TableCell>
                  <TableCell>{t('roomControl.builder.deviceTemplate')}</TableCell>
                  <TableCell align="right">{t('roomControl.import.rooms')}</TableCell>
                  <TableCell align="right">{t('roomControl.import.variables')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {preview.types.map((type) => (
                  <TableRow key={type.name} data-testid={`grms-import-type-${type.name}`}>
                    <TableCell>{type.name}</TableCell>
                    <TableCell>{type.reference_room || '—'}</TableCell>
                    <TableCell>{type.device_name_template || '—'}</TableCell>
                    <TableCell align="right">{type.rooms.length}</TableCell>
                    <TableCell align="right">{type.variables.length}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <Divider sx={{ my: 2 }} />

            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
              <Button
                variant="outlined"
                disabled={reconcileMutation.isPending}
                onClick={() => reconcileMutation.mutate()}
                data-testid="grms-import-reconcile"
              >
                {t('roomControl.import.reconcile')}
              </Button>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={replace}
                    onChange={(e) => setReplace(e.target.checked)}
                    data-testid="grms-import-replace"
                  />
                }
                label={t('roomControl.import.replace')}
              />
              <Box sx={{ flexGrow: 1 }} />
              <Button
                variant="contained"
                disabled={confirmMutation.isPending || preview.types.length === 0}
                onClick={() => confirmMutation.mutate()}
                data-testid="grms-import-confirm"
              >
                {t('roomControl.import.confirm')}
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      {reports && (
        <Card variant="outlined" sx={{ borderColor: 'divider' }} data-testid="grms-reconcile">
          <CardContent>
            <Typography variant="subtitle1">{t('roomControl.reconcile.title')}</Typography>
            <Typography variant="caption" color="text.secondary">
              {t('roomControl.reconcile.hint')}
            </Typography>
            <Divider sx={{ my: 1.5 }} />
            {!reports.checked && (
              <Alert severity="info" sx={{ mb: 2 }} data-testid="grms-reconcile-offline">
                {t('roomControl.reconcile.notBlocking')}
              </Alert>
            )}
            <Stack spacing={1.5}>
              {reports.reports.map((report) => (
                <Box key={report.type_name} data-testid={`grms-reconcile-${report.type_name}`}>
                  <Typography variant="body2">
                    {report.type_name} — {report.device || '—'}
                  </Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                    {report.checked ? (
                      <>
                        <Chip
                          size="small"
                          color={report.missing.length ? 'warning' : 'success'}
                          label={`${t('roomControl.reconcile.missing_on_server')}: ${report.missing.length}`}
                        />
                        <Chip
                          size="small"
                          color={report.extra.length ? 'warning' : 'success'}
                          label={`${t('roomControl.reconcile.extra_on_server')}: ${report.extra.length}`}
                        />
                      </>
                    ) : (
                      <Chip
                        size="small"
                        label={t(`roomControl.reconcile.${report.reason || 'not_checked'}`, {
                          defaultValue: t('roomControl.reconcile.not_checked'),
                        })}
                      />
                    )}
                  </Stack>
                  {(report.missing.length > 0 || report.extra.length > 0) && (
                    <Typography variant="caption" color="text.secondary">
                      {[...report.missing, ...report.extra].join(', ')}
                    </Typography>
                  )}
                </Box>
              ))}
            </Stack>
          </CardContent>
        </Card>
      )}
    </Stack>
  );
}
