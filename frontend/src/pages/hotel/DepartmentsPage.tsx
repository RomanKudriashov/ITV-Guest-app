import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
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
import MenuItem from '@mui/material/MenuItem';
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
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import PeopleAltIcon from '@mui/icons-material/PeopleAlt';

import { ApiError } from '@/api/client';
import {
  createDepartment,
  deleteDepartment,
  fetchDepartments,
  updateDepartment,
} from '@/api/hotelAdmin';
import {
  DEPARTMENT_KINDS,
  type Department,
  type DepartmentKind,
} from '@/api/hotelAdminTypes';
import { queryKeys } from '@/api/queryKeys';
import type { Translated } from '@/api/types';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { SchedulePicker } from '@/components/SchedulePicker';
import { TranslatedField } from '@/components/TranslatedField';
import {
  ImageUploader,
  mediaToEditable,
  persistableImageIds,
  type EditableImage,
} from '@/components/ImageUploader';
import { useToast } from '@/components/ToastProvider';
import { useBootstrap, useContentLanguages } from '@/hooks/useBootstrap';
import { compactTranslated, pickTranslated } from '@/utils/translated';

interface DepartmentForm {
  title: Translated;
  kind: DepartmentKind;
  schedule_id: string | null;
  sla_minutes: number;
  is_active: boolean;
}

const EMPTY_FORM: DepartmentForm = {
  title: {},
  kind: 'kitchen',
  schedule_id: null,
  sla_minutes: 20,
  is_active: true,
};

export function DepartmentsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: bootstrap } = useBootstrap();
  const languages = useContentLanguages(bootstrap);

  const [editing, setEditing] = useState<Department | 'new' | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Department | null>(null);

  const query = useQuery({ queryKey: queryKeys.departments, queryFn: fetchDepartments });
  const departments = query.data ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.departments });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDepartment(id),
    onSuccess: () => {
      toast.show(t('hotel.departments.deleted'), 'success');
      setPendingDelete(null);
      void invalidate();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'department_in_use') {
        toast.show(t('hotel.departments.inUse'), 'warning');
        setPendingDelete(null);
        return;
      }
      toast.show(error instanceof ApiError ? error.detail : t('errors.generic'), 'error');
    },
  });

  const title = (department: Department) =>
    pickTranslated(department.title, languages.displayLanguage, languages.defaultCode) ||
    department.code;

  return (
    <Box sx={{ p: 3 }}>
      <Card variant="outlined" sx={{ borderColor: 'divider' }}>
        <CardContent sx={{ p: 2 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
            <Stack>
              <Typography variant="h5">{t('hotel.departments.title')}</Typography>
              <Typography variant="body2" color="text.secondary">
                {t('hotel.departments.subtitle')}
              </Typography>
            </Stack>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setEditing('new')}
              data-testid="department-add"
            >
              {t('hotel.departments.add')}
            </Button>
          </Stack>
          <Divider sx={{ mb: 1 }} />

          {query.isLoading ? (
            <Stack spacing={1}>
              {[0, 1, 2].map((key) => (
                <Skeleton key={key} variant="rounded" height={48} />
              ))}
            </Stack>
          ) : query.isError ? (
            <Alert severity="error">{t('hotel.departments.loadError')}</Alert>
          ) : departments.length === 0 ? (
            <EmptyState
              testId="departments-empty"
              title={t('hotel.departments.empty')}
              description={t('hotel.departments.emptyHint')}
              action={
                <Button variant="contained" size="small" onClick={() => setEditing('new')}>
                  {t('hotel.departments.add')}
                </Button>
              }
            />
          ) : (
            <Box data-testid="departments-list">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('hotel.departments.name')}</TableCell>
                    <TableCell>{t('hotel.departments.kind')}</TableCell>
                    <TableCell>{t('hotel.departments.sla')}</TableCell>
                    <TableCell>{t('hotel.departments.links')}</TableCell>
                    <TableCell>{t('hotel.departments.active')}</TableCell>
                    <TableCell align="right">{t('common.actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {departments.map((department) => (
                    <TableRow key={department.id} hover data-testid={`department-row-${department.code}`}>
                      <TableCell>
                        <Typography variant="body2" fontWeight={500}>
                          {title(department)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {t('hotel.departments.staffCount', { count: department.staff_count })}
                          {' · '}
                          {t('hotel.departments.channelCount', { count: department.channel_count })}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip size="small" label={t(`hotel.departments.kinds.${department.kind}`)} />
                      </TableCell>
                      <TableCell>{t('hotel.departments.slaValue', { minutes: department.sla_minutes })}</TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          <Chip
                            size="small"
                            variant={department.has_escalation ? 'filled' : 'outlined'}
                            color={department.has_escalation ? 'success' : 'default'}
                            label={
                              department.has_escalation
                                ? t('hotel.departments.hasEscalation')
                                : t('hotel.departments.noEscalation')
                            }
                          />
                          <IconButton
                            size="small"
                            aria-label={t('hotel.departments.toNotifications')}
                            onClick={() => navigate(`/cms/notifications?point=${department.id}`)}
                            data-testid={`department-notifications-${department.code}`}
                          >
                            <NotificationsActiveIcon fontSize="small" />
                          </IconButton>
                          <IconButton
                            size="small"
                            aria-label={t('hotel.departments.toStaff')}
                            onClick={() => navigate(`/cms/staff?point=${department.id}`)}
                            data-testid={`department-staff-${department.code}`}
                          >
                            <PeopleAltIcon fontSize="small" />
                          </IconButton>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          variant={department.is_active ? 'filled' : 'outlined'}
                          color={department.is_active ? 'success' : 'default'}
                          label={department.is_active ? t('common.on') : t('common.off')}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <IconButton
                          size="small"
                          onClick={() => setEditing(department)}
                          aria-label={t('common.edit')}
                          data-testid={`department-edit-${department.code}`}
                        >
                          <EditOutlinedIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={() => setPendingDelete(department)}
                          aria-label={t('common.delete')}
                          data-testid={`department-delete-${department.code}`}
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
        <DepartmentDialog
          department={editing === 'new' ? null : editing}
          schedules={bootstrap?.schedules ?? []}
          dayParts={bootstrap?.day_parts ?? []}
          languages={languages}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void invalidate();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        testId="department-delete-dialog"
        destructive
        busy={deleteMutation.isPending}
        title={t('hotel.departments.deleteTitle')}
        description={t('hotel.departments.deleteBody', {
          name: pendingDelete ? title(pendingDelete) : '',
        })}
        confirmLabel={t('common.delete')}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
      />
    </Box>
  );
}

function DepartmentDialog({
  department,
  schedules,
  dayParts,
  languages,
  onClose,
  onSaved,
}: {
  department: Department | null;
  schedules: import('@/api/types').Schedule[];
  dayParts: string[];
  languages: ReturnType<typeof useContentLanguages>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();

  const [form, setForm] = useState<DepartmentForm>(
    department
      ? {
          title: { ...department.title },
          kind: department.kind,
          schedule_id: department.schedule_id ?? null,
          sla_minutes: department.sla_minutes,
          is_active: department.is_active,
        }
      : EMPTY_FORM,
  );
  const [image, setImage] = useState<EditableImage[]>(
    department?.image ? [mediaToEditable(department.image)] : [],
  );

  const titleMissing = !form.title[languages.defaultCode]?.trim();

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        title: compactTranslated(form.title),
        kind: form.kind,
        schedule_id: form.schedule_id,
        sla_minutes: form.sla_minutes,
        is_active: form.is_active,
        image_id: persistableImageIds(image)[0] ?? null,
      };
      return department ? updateDepartment(department.id, payload) : createDepartment(payload);
    },
    onSuccess: () => {
      toast.show(t('hotel.departments.saved'), 'success');
      onSaved();
    },
    onError: (error) =>
      toast.show(error instanceof ApiError ? error.detail : t('errors.generic'), 'error'),
  });

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth data-testid="department-dialog">
      <DialogTitle>
        {department ? t('hotel.departments.editTitle') : t('hotel.departments.newTitle')}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <TranslatedField
            label={t('hotel.departments.name')}
            value={form.title}
            onChange={(title) => setForm((prev) => ({ ...prev, title }))}
            languages={languages.codes}
            languageLabels={languages.labels}
            defaultLanguage={languages.defaultCode}
            required
            error={
              titleMissing
                ? t('validation.titleRequiredIn', {
                    language: languages.labels[languages.defaultCode] ?? languages.defaultCode,
                  })
                : undefined
            }
            testId="department-title"
          />

          <Box>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
              {t('hotel.departments.photo')}
            </Typography>
            <ImageUploader
              value={image}
              onChange={setImage}
              kind="category"
              multiple={false}
              testId="department-image-uploader"
            />
          </Box>

          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            <TextField
              select
              size="small"
              label={t('hotel.departments.kind')}
              value={form.kind}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, kind: event.target.value as DepartmentKind }))
              }
              sx={{ minWidth: 200 }}
              inputProps={{ 'data-testid': 'department-kind' }}
            >
              {DEPARTMENT_KINDS.map((kind) => (
                <MenuItem key={kind} value={kind}>
                  {t(`hotel.departments.kinds.${kind}`)}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              size="small"
              type="number"
              label={t('hotel.departments.sla')}
              value={form.sla_minutes}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, sla_minutes: Number(event.target.value) }))
              }
              sx={{ width: 160 }}
              inputProps={{ 'data-testid': 'department-sla', min: 0 }}
            />

            <FormControlLabel
              control={
                <Switch
                  checked={form.is_active}
                  onChange={(event) => setForm((prev) => ({ ...prev, is_active: event.target.checked }))}
                />
              }
              label={t('hotel.departments.active')}
            />
          </Stack>

          <Box>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
              {t('schedule.section')}
            </Typography>
            <SchedulePicker
              value={form.schedule_id}
              onChange={(schedule_id) => setForm((prev) => ({ ...prev, schedule_id }))}
              schedules={schedules}
              dayParts={dayParts}
              testId="department-schedule"
            />
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          disabled={titleMissing || mutation.isPending}
          onClick={() => mutation.mutate()}
          data-testid="department-save"
        >
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
