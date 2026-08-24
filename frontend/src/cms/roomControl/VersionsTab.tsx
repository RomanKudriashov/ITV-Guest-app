import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';

import { ApiError } from '@/api/client';
import { fetchVersions, publishType, rollbackType, type GrmsType } from '@/api/grms';
import { useGrmsScope } from './scope';
import { queryKeys } from '@/api/queryKeys';
import { EmptyState } from '@/components/EmptyState';
import { useToast } from '@/components/ToastProvider';

/**
 * Публикация и история версий.
 *
 * Публикация — единственный способ, которым правки доезжают до гостя: пока её
 * нет, номер работает по прошлому снимку. Откат возвращает СНИМОК ЦЕЛИКОМ
 * вместе с разметкой плана — именно поэтому геометрия лежит в снимке, а не
 * читается из черновика при выдаче.
 *
 * Ошибка публикации показывается как есть, включая «план ссылается на то, чего
 * не будет в этой версии»: это не придирка сторожа, а зона на плане, которая
 * перестала бы нажиматься в номере.
 */
export function VersionsTab({ type }: { type: GrmsType }) {
  const { t } = useTranslation();
  // База API — из области: CMS отеля или консоль платформы.
  const { transport } = useGrmsScope();
  const base = transport.base;
  const toast = useToast();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.grmsVersions(base, type.code),
    queryFn: () => fetchVersions(transport, type.code),
  });

  const failure = (error: unknown) =>
    toast.show(error instanceof ApiError ? error.detail : t('errors.generic'), 'error');

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.grmsVersions(base, type.code) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.grmsPlan(base, type.code) });
  };

  const publishMutation = useMutation({
    mutationFn: () => publishType(transport, type.code),
    onSuccess: (result) => {
      refresh();
      toast.show(t('roomControl.publish.published', { version: result.version }), 'success');
    },
    onError: failure,
  });

  const rollbackMutation = useMutation({
    mutationFn: (version: number) => rollbackType(transport, type.code, version),
    onSuccess: () => {
      refresh();
      toast.show(t('roomControl.publish.rolledBack'), 'success');
    },
    onError: failure,
  });

  if (query.isLoading) return <Skeleton variant="rounded" height={280} />;
  if (query.isError || !query.data) {
    return <Alert severity="error">{t('roomControl.publish.loadError')}</Alert>;
  }

  const versions = query.data.versions;

  return (
    <Card variant="outlined" sx={{ borderColor: 'divider' }} data-testid="grms-versions">
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={2}>
          <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="subtitle1">{t('roomControl.publish.title')}</Typography>
            <Typography variant="caption" color="text.secondary">
              {t('roomControl.publish.hint')}
            </Typography>
          </Stack>
          <Button
            variant="contained"
            disabled={publishMutation.isPending}
            onClick={() => publishMutation.mutate()}
            data-testid="grms-publish"
          >
            {t('roomControl.publish.publish')}
          </Button>
        </Stack>
        <Divider sx={{ my: 1.5 }} />

        {versions.length === 0 ? (
          <EmptyState
            testId="grms-versions-empty"
            title={t('roomControl.publish.noVersions')}
            description={t('roomControl.publish.noVersionsHint')}
          />
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('roomControl.publish.version')}</TableCell>
                <TableCell>{t('roomControl.publish.publishedAt')}</TableCell>
                <TableCell align="right">{t('roomControl.publish.controls')}</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {versions.map((version) => (
                <TableRow key={version.version} data-testid={`grms-version-${version.version}`}>
                  <TableCell>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <span>{version.version}</span>
                      {version.is_current && (
                        <Chip size="small" color="success" label={t('roomControl.publish.current')} />
                      )}
                      {version.rolled_back_from !== null && (
                        <Chip
                          size="small"
                          variant="outlined"
                          label={t('roomControl.publish.rolledBackFrom', {
                            version: version.rolled_back_from,
                          })}
                        />
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>{new Date(version.published_at).toLocaleString()}</TableCell>
                  <TableCell align="right">{version.controls}</TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      disabled={version.is_current || rollbackMutation.isPending}
                      onClick={() => rollbackMutation.mutate(version.version)}
                      data-testid={`grms-rollback-${version.version}`}
                    >
                      {t('roomControl.publish.rollback')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
