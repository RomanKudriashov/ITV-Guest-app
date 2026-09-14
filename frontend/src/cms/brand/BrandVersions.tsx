/**
 * ЧЕРНОВИКИ И ВЕРСИИ ОФОРМЛЕНИЯ — ОДНИМ ЭКРАНОМ.
 *
 * До этой партии черновик жил в браузере: закрыл вкладку — работы нет. Двое
 * правивших не знали друг о друге, выигрывал сохранивший вторым. Вернуться к
 * прежнему оформлению было нечем: прежнего не существовало.
 *
 * ПОЧЕМУ ОДИН ЭКРАН, А НЕ ДВА. Черновик и версия отвечают на один вопрос —
 * «какое оформление взять». Разведённые по вкладкам, они заставили бы оператора
 * помнить, в какой из них лежит то, что он ищет: «то, что я готовил» и «то, что
 * было в прошлый четверг» для него одного рода.
 *
 * ОТКАТ ПОДПИСАН КАК ОТКАТ. В ряду одинаковых публикаций непонятно, почему
 * оформление вдруг стало прежним; строка «вернули к версии 7» отвечает на это
 * сразу — и называет, кто и когда.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import {
  createBrandDraft,
  deleteBrandDraft,
  fetchBrandDraft,
  fetchBrandDrafts,
  fetchBrandVersions,
  publishBrandDraft,
  restoreBrandVersion,
  type BrandVersionRecord,
} from '@/api/brand';
import { queryKeys } from '@/api/queryKeys';
import type { PartialBrandTokens } from '@/theme/tokens';

const DRAFTS_KEY = ['cms', 'brand', 'drafts'] as const;
const VERSIONS_KEY = ['cms', 'brand', 'versions'] as const;

export interface BrandVersionsProps {
  /** Текущий черновик редактора — его и сохраняем как именованный. */
  tokens: PartialBrandTokens;
  /** Открыть сохранённый набор в редакторе. */
  onOpen: (tokens: PartialBrandTokens) => void;
}

function when(value: string | null): string {
  if (!value) return '';
  return new Date(value).toLocaleString();
}

export function BrandVersions({ tokens, onOpen }: BrandVersionsProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const drafts = useQuery({ queryKey: DRAFTS_KEY, queryFn: fetchBrandDrafts });
  const versions = useQuery({ queryKey: VERSIONS_KEY, queryFn: fetchBrandVersions });

  const [name, setName] = useState('');
  const [stale, setStale] = useState<BrandVersionRecord | null>(null);
  const [failure, setFailure] = useState('');

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: DRAFTS_KEY });
    void queryClient.invalidateQueries({ queryKey: VERSIONS_KEY });
    // Метка «своё оформление» считается по опубликованной версии — после
    // публикации она обязана перечитаться, иначе покажет прошлую.
    void queryClient.invalidateQueries({ queryKey: ['cms', 'brand', 'look'] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.brand });
  };

  const saveDraft = useMutation({
    mutationFn: () => createBrandDraft(name.trim(), tokens),
    onSuccess: () => {
      setName('');
      refresh();
    },
  });

  const publish = useMutation({
    mutationFn: ({ id, confirm }: { id: string; confirm: boolean }) =>
      publishBrandDraft(id, confirm),
    onSuccess: () => {
      setStale(null);
      setFailure('');
      refresh();
    },
    onError: (error, variables) => {
      /*
        УСТАРЕВШИЙ ЧЕРНОВИК НЕ ПУБЛИКУЕТСЯ ПО ОШИБКЕ.

        Сервер отказывает кодом `draft_stale` и называет обе версии. Панель не
        повторяет запрос с подтверждением молча: показывает, что именно
        произойдёт, и ждёт второго, отдельного нажатия.
      */
      const record = drafts.data?.drafts.find((draft) => draft.id === variables.id) ?? null;
      const message = error instanceof Error ? error.message : t('brand.versions.publishFailed');
      if (record && message.includes('верси')) {
        setStale(record);
        setFailure(message);
        return;
      }
      setFailure(message);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteBrandDraft(id),
    onSuccess: refresh,
  });

  const restore = useMutation({
    mutationFn: (id: string) => restoreBrandVersion(id),
    onSuccess: refresh,
  });

  const open = useMutation({
    mutationFn: (id: string) => fetchBrandDraft(id),
    onSuccess: (draft) => onOpen(draft.tokens ?? {}),
  });

  return (
    <Stack spacing={2} data-testid="brand-versions">
      {failure && !stale ? (
        <Alert severity="warning" data-testid="brand-versions-error">
          {failure}
        </Alert>
      ) : null}

      {/* Сохранить текущее состояние редактора черновиком */}
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <TextField
          size="small"
          label={t('brand.versions.draftName')}
          value={name}
          onChange={(event) => setName(event.target.value)}
          inputProps={{ maxLength: 120, 'data-testid': 'brand-draft-name' }}
          sx={{ minWidth: 240 }}
        />
        <Button
          variant="outlined"
          disabled={!name.trim() || saveDraft.isPending}
          onClick={() => saveDraft.mutate()}
          data-testid="brand-draft-save"
        >
          {t('brand.versions.saveDraft')}
        </Button>
        <Typography variant="caption" color="text.secondary">
          {t('brand.versions.draftHint')}
        </Typography>
      </Stack>

      <Divider />

      {/* Черновики */}
      <Box>
        <Typography variant="subtitle2" gutterBottom>
          {t('brand.versions.drafts')}
        </Typography>
        {(drafts.data?.drafts.length ?? 0) === 0 ? (
          <Typography variant="body2" color="text.secondary" data-testid="brand-drafts-empty">
            {t('brand.versions.draftsEmpty')}
          </Typography>
        ) : (
          <Stack spacing={1}>
            {drafts.data?.drafts.map((draft) => (
              <Stack
                key={draft.id}
                direction="row"
                spacing={1}
                alignItems="center"
                flexWrap="wrap"
                useFlexGap
                data-testid={`brand-draft-${draft.id}`}
              >
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {draft.name || t('brand.versions.unnamed')}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ mr: 'auto' }}>
                  {when(draft.created_at)} · {draft.author || t('brand.versions.unknownAuthor')}
                </Typography>
                {draft.is_stale ? (
                  <Chip
                    size="small"
                    color="warning"
                    variant="outlined"
                    label={t('brand.versions.stale')}
                    data-testid="brand-draft-stale"
                  />
                ) : null}
                <Button size="small" onClick={() => open.mutate(draft.id)} data-testid="brand-draft-open">
                  {t('brand.versions.open')}
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  onClick={() => publish.mutate({ id: draft.id, confirm: false })}
                  data-testid="brand-draft-publish"
                >
                  {t('brand.versions.publish')}
                </Button>
                <Button
                  size="small"
                  color="inherit"
                  onClick={() => remove.mutate(draft.id)}
                  data-testid="brand-draft-delete"
                >
                  {t('common.delete')}
                </Button>
              </Stack>
            ))}
          </Stack>
        )}
      </Box>

      <Divider />

      {/* История публикаций */}
      <Box>
        <Typography variant="subtitle2" gutterBottom>
          {t('brand.versions.history')}
        </Typography>
        {(versions.data?.versions.length ?? 0) === 0 ? (
          <Typography variant="body2" color="text.secondary" data-testid="brand-versions-empty">
            {t('brand.versions.historyEmpty')}
          </Typography>
        ) : (
          <Stack spacing={1}>
            {versions.data?.versions.map((version, index) => (
              <Stack
                key={version.id}
                direction="row"
                spacing={1}
                alignItems="center"
                flexWrap="wrap"
                useFlexGap
                data-testid={`brand-version-${version.number}`}
              >
                <Chip
                  size="small"
                  variant={index === 0 ? 'filled' : 'outlined'}
                  label={t('brand.versions.number', { number: version.number })}
                />
                <Typography variant="caption" color="text.secondary" sx={{ mr: 'auto' }}>
                  {when(version.published_at)} ·{' '}
                  {version.author || t('brand.versions.unknownAuthor')}
                  {version.restored_from
                    ? ` · ${t('brand.versions.restoredFrom', {
                        number: version.restored_from.number,
                      })}`
                    : version.name
                      ? ` · ${version.name}`
                      : ''}
                </Typography>
                {index === 0 ? (
                  <Chip
                    size="small"
                    color="success"
                    variant="outlined"
                    label={t('brand.versions.live')}
                    data-testid="brand-version-live"
                  />
                ) : (
                  <Button
                    size="small"
                    onClick={() => restore.mutate(version.id)}
                    data-testid="brand-version-restore"
                  >
                    {t('brand.versions.restore')}
                  </Button>
                )}
              </Stack>
            ))}
          </Stack>
        )}
      </Box>

      {/* Подтверждение публикации устаревшего черновика */}
      <Dialog open={Boolean(stale)} onClose={() => setStale(null)} data-testid="brand-stale-dialog">
        <DialogTitle>{t('brand.versions.staleTitle')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">{failure}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStale(null)} data-testid="brand-stale-cancel">
            {t('common.cancel')}
          </Button>
          <Button
            color="warning"
            variant="contained"
            onClick={() => stale && publish.mutate({ id: stale.id, confirm: true })}
            data-testid="brand-stale-confirm"
          >
            {t('brand.versions.publishAnyway')}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
