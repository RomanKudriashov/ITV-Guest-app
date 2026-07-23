import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import CheckIcon from '@mui/icons-material/Check';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';

import { ApiError } from '@/api/client';
import { createBadge, deleteBadge, fetchBadges, updateBadge } from '@/api/cms';
import { queryKeys } from '@/api/queryKeys';
import type { Badge, BadgeColorRole, Translated } from '@/api/types';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { useToast } from '@/components/ToastProvider';
import { useBootstrap, useContentLanguages } from '@/hooks/useBootstrap';
import { BADGE_COLOR_ROLES, badgeRoleColor } from '@/kit/chips';
import { compactTranslated, pickTranslated } from '@/utils/translated';

/** A solid pill in the badge's role color — the live preview of a badge. */
function BadgePreview({ label, role }: { label: string; role: BadgeColorRole }) {
  return (
    <Box
      sx={(theme) => {
        const color = badgeRoleColor(role, theme);
        return {
          display: 'inline-flex',
          alignItems: 'center',
          px: 1,
          py: 0.25,
          borderRadius: `${theme.palette.brand.radius.pill}px`,
          bgcolor: color,
          color: theme.palette.getContrastText(color),
          fontSize: '0.72rem',
          fontWeight: theme.typography.fontWeightBold,
          lineHeight: 1.4,
        };
      }}
    >
      {label}
    </Box>
  );
}

export function BadgesPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: bootstrap } = useBootstrap();
  const languages = useContentLanguages(bootstrap);

  const [editing, setEditing] = useState<Badge | 'new' | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Badge | null>(null);

  const badgesQuery = useQuery({ queryKey: queryKeys.badges, queryFn: fetchBadges });
  const badges = badgesQuery.data ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.badges });

  const badgeLabel = (badge: Badge) =>
    pickTranslated(badge.label, languages.displayLanguage, languages.defaultCode) || badge.id;

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteBadge(id),
    onSuccess: () => {
      toast.show(t('badges.deleted'), 'success');
      setPendingDelete(null);
      void invalidate();
    },
    onError: (error) => {
      toast.show(error instanceof ApiError ? error.detail : t('errors.generic'), 'error');
    },
  });

  return (
    <Box sx={{ p: 3 }}>
      <Card variant="outlined" sx={{ borderColor: 'divider' }}>
        <CardContent sx={{ p: 2 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
            <Stack>
              <Typography variant="h5">{t('badges.title')}</Typography>
              <Typography variant="body2" color="text.secondary">
                {t('badges.subtitle')}
              </Typography>
            </Stack>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setEditing('new')}
              data-testid="cms-badge-add"
            >
              {t('badges.add')}
            </Button>
          </Stack>
          <Divider sx={{ mb: 1 }} />

          {badgesQuery.isLoading ? (
            <Stack spacing={1}>
              {[0, 1, 2].map((key) => (
                <Skeleton key={key} variant="rounded" height={48} />
              ))}
            </Stack>
          ) : badgesQuery.isError ? (
            <Alert severity="error">{t('badges.loadError')}</Alert>
          ) : badges.length === 0 ? (
            <EmptyState
              testId="cms-badge-empty"
              title={t('badges.empty')}
              description={t('badges.emptyHint')}
              action={
                <Button variant="contained" size="small" onClick={() => setEditing('new')}>
                  {t('badges.add')}
                </Button>
              }
            />
          ) : (
            <Box data-testid="cms-badge-list">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('badges.preview')}</TableCell>
                    <TableCell>{t('badges.role')}</TableCell>
                    <TableCell>{t('badges.sortOrder')}</TableCell>
                    <TableCell>{t('badges.active')}</TableCell>
                    <TableCell align="right">{t('common.actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {badges.map((badge) => (
                    <TableRow key={badge.id} hover data-testid={`cms-badge-row-${badge.id}`}>
                      <TableCell>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <BadgePreview label={badgeLabel(badge)} role={badge.color_role} />
                          {badge.preset ? (
                            <Chip size="small" variant="outlined" label={t('badges.preset')} />
                          ) : null}
                        </Stack>
                      </TableCell>
                      <TableCell>{t(`badges.roles.${badge.color_role}`)}</TableCell>
                      <TableCell>{badge.sort_order}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          variant={badge.is_active ? 'filled' : 'outlined'}
                          color={badge.is_active ? 'success' : 'default'}
                          label={badge.is_active ? t('common.on') : t('common.off')}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <IconButton
                          size="small"
                          onClick={() => setEditing(badge)}
                          aria-label={t('common.edit')}
                          data-testid={`cms-badge-edit-${badge.id}`}
                        >
                          <EditOutlinedIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={() => setPendingDelete(badge)}
                          aria-label={t('common.delete')}
                          data-testid={`cms-badge-delete-${badge.id}`}
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
        </CardContent>
      </Card>

      {editing ? (
        <BadgeDialog
          badge={editing === 'new' ? null : editing}
          defaultLanguage={languages.defaultCode}
          displayLanguage={languages.displayLanguage}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void invalidate();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        testId="cms-badge-delete-dialog"
        destructive
        busy={deleteMutation.isPending}
        title={t('badges.deleteTitle')}
        description={t('badges.deleteBody', {
          name: pendingDelete ? badgeLabel(pendingDelete) : '',
        })}
        confirmLabel={t('common.delete')}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
      />
    </Box>
  );
}

interface BadgeForm {
  labelRu: string;
  labelEn: string;
  color_role: BadgeColorRole;
  sort_order: number;
  is_active: boolean;
}

function BadgeDialog({
  badge,
  defaultLanguage,
  displayLanguage,
  onClose,
  onSaved,
}: {
  badge: Badge | null;
  defaultLanguage: string;
  displayLanguage: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const isNew = !badge;

  const [form, setForm] = useState<BadgeForm>(() => ({
    labelRu: badge?.label?.ru ?? '',
    labelEn: badge?.label?.en ?? '',
    color_role: badge?.color_role ?? 'accent',
    sort_order: badge?.sort_order ?? 0,
    is_active: badge?.is_active ?? true,
  }));
  const [serverError, setServerError] = useState<string | null>(null);

  const labelInvalid = !form.labelRu.trim() && !form.labelEn.trim();

  const mutation = useMutation({
    mutationFn: () => {
      const label: Translated = compactTranslated({ ru: form.labelRu, en: form.labelEn });
      const payload = {
        label,
        color_role: form.color_role,
        sort_order: form.sort_order,
        is_active: form.is_active,
      };
      return badge ? updateBadge(badge.id, payload) : createBadge(payload);
    },
    onSuccess: () => {
      toast.show(t('badges.saved'), 'success');
      onSaved();
    },
    onError: (error) => {
      setServerError(error instanceof ApiError ? error.detail : t('errors.generic'));
    },
  });

  const previewLabel =
    pickTranslated(
      compactTranslated({ ru: form.labelRu, en: form.labelEn }),
      displayLanguage,
      defaultLanguage,
    ) || t('badges.previewPlaceholder');

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth data-testid="cms-badge-dialog">
      <DialogTitle>{isNew ? t('badges.newTitle') : t('badges.editTitle')}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          {serverError ? <Alert severity="error">{serverError}</Alert> : null}

          <Stack direction="row" spacing={2}>
            <TextField
              size="small"
              label={t('badges.labelRu')}
              value={form.labelRu}
              onChange={(event) => setForm((prev) => ({ ...prev, labelRu: event.target.value }))}
              inputProps={{ 'data-testid': 'cms-badge-label-ru' }}
              fullWidth
            />
            <TextField
              size="small"
              label={t('badges.labelEn')}
              value={form.labelEn}
              onChange={(event) => setForm((prev) => ({ ...prev, labelEn: event.target.value }))}
              inputProps={{ 'data-testid': 'cms-badge-label-en' }}
              fullWidth
            />
          </Stack>

          <Stack spacing={1}>
            <Typography variant="subtitle2">{t('badges.role')}</Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {BADGE_COLOR_ROLES.map((role) => {
                const selected = form.color_role === role;
                return (
                  <ButtonBase
                    key={role}
                    onClick={() => setForm((prev) => ({ ...prev, color_role: role }))}
                    focusRipple
                    role="radio"
                    aria-checked={selected}
                    data-testid={`cms-badge-role-${role}`}
                    sx={(theme) => ({
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 0.75,
                      minWidth: 96,
                      px: 1.5,
                      py: 1.25,
                      borderRadius: `${theme.palette.brand.radius.md}px`,
                      border: `1.5px solid ${
                        selected ? theme.palette.primary.main : theme.palette.divider
                      }`,
                      bgcolor: selected
                        ? theme.palette.brand.surfaceSelected
                        : theme.palette.brand.surfaceMuted,
                      '&.Mui-focusVisible': {
                        outline: `2px solid ${theme.palette.primary.main}`,
                        outlineOffset: 2,
                      },
                    })}
                  >
                    <Box
                      sx={(theme) => {
                        const color = badgeRoleColor(role, theme);
                        return {
                          width: 32,
                          height: 32,
                          borderRadius: `${theme.palette.brand.radius.pill}px`,
                          bgcolor: color,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: theme.palette.getContrastText(color),
                        };
                      }}
                    >
                      {selected ? <CheckIcon fontSize="small" /> : null}
                    </Box>
                    <Typography variant="caption">{t(`badges.roles.${role}`)}</Typography>
                  </ButtonBase>
                );
              })}
            </Stack>
          </Stack>

          <Stack direction="row" spacing={2} alignItems="center">
            <TextField
              size="small"
              type="number"
              label={t('badges.sortOrder')}
              value={form.sort_order}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, sort_order: Number(event.target.value) }))
              }
              sx={{ width: 160 }}
              inputProps={{ 'data-testid': 'cms-badge-sort' }}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={form.is_active}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, is_active: event.target.checked }))
                  }
                  inputProps={{ 'data-testid': 'cms-badge-active' } as Record<string, string>}
                />
              }
              label={t('badges.active')}
            />
          </Stack>

          <Divider />

          <Stack direction="row" spacing={1.5} alignItems="center">
            <Typography variant="caption" color="text.secondary">
              {t('badges.livePreview')}
            </Typography>
            <BadgePreview label={previewLabel} role={form.color_role} />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          disabled={labelInvalid || mutation.isPending}
          onClick={() => mutation.mutate()}
          data-testid="cms-badge-save"
        >
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
