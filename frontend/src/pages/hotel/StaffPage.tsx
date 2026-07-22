import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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

import { ApiError } from '@/api/client';
import {
  createStaff,
  deleteStaff,
  fetchDepartments,
  fetchStaff,
  updateStaff,
  updateStaffAssignments,
} from '@/api/hotelAdmin';
import {
  STAFF_LEVELS,
  type Department,
  type StaffLevel,
  type StaffMember,
} from '@/api/hotelAdminTypes';
import { queryKeys } from '@/api/queryKeys';
import { useAuth } from '@/auth';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { useToast } from '@/components/ToastProvider';
import { useBootstrap, useContentLanguages } from '@/hooks/useBootstrap';
import { pickTranslated } from '@/utils/translated';

interface AssignmentDraft {
  key: string;
  execution_point_id: string;
  level: StaffLevel;
}

interface StaffForm {
  email: string;
  full_name: string;
  password: string;
  language: string;
  is_hotel_admin: boolean;
  is_active: boolean;
  assignments: AssignmentDraft[];
}

const randomKey = () => Math.random().toString(36).slice(2);

export function StaffPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();

  const { data: bootstrap } = useBootstrap();
  const languages = useContentLanguages(bootstrap);

  const [editing, setEditing] = useState<StaffMember | 'new' | null>(null);
  const [pendingDelete, setPendingDelete] = useState<StaffMember | null>(null);

  const staffQuery = useQuery({ queryKey: queryKeys.staff, queryFn: fetchStaff });
  const departmentsQuery = useQuery({
    queryKey: queryKeys.departments,
    queryFn: fetchDepartments,
  });
  const staff = staffQuery.data ?? [];
  const departments = departmentsQuery.data ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.staff });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteStaff(id),
    onSuccess: () => {
      toast.show(t('hotel.staff.deleted'), 'success');
      setPendingDelete(null);
      void invalidate();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'cannot_remove_self') {
        toast.show(t('hotel.staff.cannotRemoveSelf'), 'warning');
        setPendingDelete(null);
        return;
      }
      toast.show(error instanceof ApiError ? error.detail : t('errors.generic'), 'error');
    },
  });

  const departmentLabel = (id: string) => {
    const department = departments.find((entry) => entry.id === id);
    return department
      ? pickTranslated(department.title, languages.displayLanguage, languages.defaultCode) ||
          department.code
      : id;
  };

  return (
    <Box sx={{ p: 3 }}>
      <Card variant="outlined" sx={{ borderColor: 'divider' }}>
        <CardContent sx={{ p: 2 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
            <Stack>
              <Typography variant="h5">{t('hotel.staff.title')}</Typography>
              <Typography variant="body2" color="text.secondary">
                {t('hotel.staff.subtitle')}
              </Typography>
            </Stack>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setEditing('new')}
              data-testid="staff-add"
            >
              {t('hotel.staff.add')}
            </Button>
          </Stack>
          <Divider sx={{ mb: 1 }} />

          {staffQuery.isLoading ? (
            <Stack spacing={1}>
              {[0, 1, 2].map((key) => (
                <Skeleton key={key} variant="rounded" height={48} />
              ))}
            </Stack>
          ) : staffQuery.isError ? (
            <Alert severity="error">{t('hotel.staff.loadError')}</Alert>
          ) : staff.length === 0 ? (
            <EmptyState
              testId="staff-empty"
              title={t('hotel.staff.empty')}
              description={t('hotel.staff.emptyHint')}
              action={
                <Button variant="contained" size="small" onClick={() => setEditing('new')}>
                  {t('hotel.staff.add')}
                </Button>
              }
            />
          ) : (
            <Box data-testid="staff-list">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('hotel.staff.fullName')}</TableCell>
                    <TableCell>{t('hotel.staff.email')}</TableCell>
                    <TableCell>{t('hotel.staff.assignments')}</TableCell>
                    <TableCell>{t('hotel.staff.active')}</TableCell>
                    <TableCell align="right">{t('common.actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {staff.map((member) => (
                    <TableRow key={member.id} hover data-testid={`staff-row-${member.email}`}>
                      <TableCell>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography variant="body2" fontWeight={500}>
                            {member.full_name || '—'}
                          </Typography>
                          {member.is_hotel_admin ? (
                            <Chip size="small" color="secondary" label={t('hotel.staff.admin')} />
                          ) : null}
                        </Stack>
                      </TableCell>
                      <TableCell>{member.email}</TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                          {member.assignments.length === 0 ? (
                            <Typography variant="caption" color="text.secondary">
                              {t('hotel.staff.noAssignments')}
                            </Typography>
                          ) : (
                            member.assignments.map((assignment) => (
                              <Chip
                                key={assignment.id ?? assignment.execution_point_id}
                                size="small"
                                variant="outlined"
                                label={`${departmentLabel(assignment.execution_point_id)} · ${t(
                                  `hotel.staff.levels.${assignment.level}`,
                                )}`}
                              />
                            ))
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          variant={member.is_active ? 'filled' : 'outlined'}
                          color={member.is_active ? 'success' : 'default'}
                          label={member.is_active ? t('common.on') : t('common.off')}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <IconButton
                          size="small"
                          onClick={() => setEditing(member)}
                          aria-label={t('common.edit')}
                          data-testid={`staff-edit-${member.email}`}
                        >
                          <EditOutlinedIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={() => setPendingDelete(member)}
                          aria-label={t('common.delete')}
                          data-testid={`staff-delete-${member.email}`}
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
        <StaffDialog
          member={editing === 'new' ? null : editing}
          departments={departments}
          languageCodes={languages.codes}
          languageLabels={languages.labels}
          defaultLanguage={languages.defaultCode}
          displayLanguage={languages.displayLanguage}
          fallbackLanguage={languages.defaultCode}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void invalidate();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        testId="staff-delete-dialog"
        destructive
        busy={deleteMutation.isPending}
        title={t('hotel.staff.deleteTitle')}
        description={
          pendingDelete && user?.id === pendingDelete.id
            ? t('hotel.staff.cannotRemoveSelf')
            : t('hotel.staff.deleteBody', { name: pendingDelete?.full_name || pendingDelete?.email || '' })
        }
        confirmLabel={t('common.delete')}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
      />
    </Box>
  );
}

function StaffDialog({
  member,
  departments,
  languageCodes,
  languageLabels,
  defaultLanguage,
  displayLanguage,
  fallbackLanguage,
  onClose,
  onSaved,
}: {
  member: StaffMember | null;
  departments: Department[];
  languageCodes: string[];
  languageLabels: Record<string, string>;
  defaultLanguage: string;
  displayLanguage: string;
  fallbackLanguage: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const isNew = !member;

  const [form, setForm] = useState<StaffForm>(() => ({
    email: member?.email ?? '',
    full_name: member?.full_name ?? '',
    password: '',
    language: member?.language ?? defaultLanguage,
    is_hotel_admin: member?.is_hotel_admin ?? false,
    is_active: member?.is_active ?? true,
    assignments: (member?.assignments ?? []).map((assignment) => ({
      key: randomKey(),
      execution_point_id: assignment.execution_point_id,
      level: assignment.level,
    })),
  }));
  const [serverError, setServerError] = useState<string | null>(null);

  const emailInvalid = !form.email.trim();
  const passwordInvalid = isNew && form.password.trim().length < 8;

  const departmentLabel = (department: Department) =>
    pickTranslated(department.title, displayLanguage, fallbackLanguage) || department.code;

  const mutation = useMutation({
    mutationFn: async () => {
      const assignments = form.assignments
        .filter((assignment) => assignment.execution_point_id)
        .map((assignment) => ({
          execution_point_id: assignment.execution_point_id,
          level: assignment.level,
        }));

      if (isNew) {
        return createStaff({
          email: form.email.trim(),
          full_name: form.full_name.trim(),
          password: form.password,
          language: form.language,
          is_hotel_admin: form.is_hotel_admin,
          assignments,
        });
      }

      // PATCH the profile (password only when a new one was typed), then replace
      // the assignment set — the contract keeps them on separate endpoints.
      const patch: Record<string, unknown> = {
        email: form.email.trim(),
        full_name: form.full_name.trim(),
        language: form.language,
        is_hotel_admin: form.is_hotel_admin,
        is_active: form.is_active,
      };
      if (form.password.trim()) patch.password = form.password;
      await updateStaff(member.id, patch);
      return updateStaffAssignments(member.id, { assignments });
    },
    onSuccess: () => {
      toast.show(t('hotel.staff.saved'), 'success');
      onSaved();
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        if (error.code === 'email_taken') return setServerError(t('hotel.staff.emailTaken'));
        if (error.code === 'weak_password') return setServerError(t('hotel.staff.weakPassword'));
        if (error.code === 'cannot_remove_self')
          return setServerError(t('hotel.staff.cannotRemoveSelf'));
        return setServerError(error.detail);
      }
      setServerError(t('errors.generic'));
    },
  });

  const patchAssignment = (key: string, changes: Partial<AssignmentDraft>) =>
    setForm((prev) => ({
      ...prev,
      assignments: prev.assignments.map((assignment) =>
        assignment.key === key ? { ...assignment, ...changes } : assignment,
      ),
    }));

  const addAssignment = () =>
    setForm((prev) => ({
      ...prev,
      assignments: [
        ...prev.assignments,
        { key: randomKey(), execution_point_id: departments[0]?.id ?? '', level: 'member' },
      ],
    }));

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth data-testid="staff-dialog">
      <DialogTitle>{isNew ? t('hotel.staff.newTitle') : t('hotel.staff.editTitle')}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          {serverError ? <Alert severity="error">{serverError}</Alert> : null}

          <Stack direction="row" spacing={2}>
            <TextField
              size="small"
              type="email"
              label={t('hotel.staff.email')}
              value={form.email}
              onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
              inputProps={{ 'data-testid': 'staff-email' }}
              required
              fullWidth
            />
            <TextField
              size="small"
              label={t('hotel.staff.fullName')}
              value={form.full_name}
              onChange={(event) => setForm((prev) => ({ ...prev, full_name: event.target.value }))}
              inputProps={{ 'data-testid': 'staff-full-name' }}
              fullWidth
            />
          </Stack>

          <Stack direction="row" spacing={2}>
            <TextField
              size="small"
              type="password"
              label={t('hotel.staff.password')}
              value={form.password}
              onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
              inputProps={{ 'data-testid': 'staff-password' }}
              helperText={isNew ? t('hotel.staff.passwordHint') : t('hotel.staff.passwordKeepHint')}
              error={passwordInvalid && form.password.length > 0}
              required={isNew}
              fullWidth
            />
            <TextField
              select
              size="small"
              label={t('hotel.staff.language')}
              value={form.language}
              onChange={(event) => setForm((prev) => ({ ...prev, language: event.target.value }))}
              inputProps={{ 'data-testid': 'staff-language' }}
              sx={{ minWidth: 160 }}
            >
              {languageCodes.map((code) => (
                <MenuItem key={code} value={code}>
                  {languageLabels[code] ?? code}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          <Stack direction="row" spacing={2}>
            <FormControlLabel
              control={
                <Switch
                  checked={form.is_hotel_admin}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, is_hotel_admin: event.target.checked }))
                  }
                  inputProps={{ 'data-testid': 'staff-admin' } as Record<string, string>}
                />
              }
              label={t('hotel.staff.admin')}
            />
            {!isNew ? (
              <FormControlLabel
                control={
                  <Switch
                    checked={form.is_active}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, is_active: event.target.checked }))
                    }
                  />
                }
                label={t('hotel.staff.active')}
              />
            ) : null}
          </Stack>

          <Divider />

          <Stack spacing={1}>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography variant="subtitle2">{t('hotel.staff.assignments')}</Typography>
              <Button
                size="small"
                startIcon={<AddIcon />}
                disabled={departments.length === 0}
                onClick={addAssignment}
                data-testid="staff-assignment-add"
              >
                {t('hotel.staff.addAssignment')}
              </Button>
            </Stack>

            {departments.length === 0 ? (
              <Typography variant="caption" color="text.secondary">
                {t('hotel.staff.noDepartments')}
              </Typography>
            ) : form.assignments.length === 0 ? (
              <Typography variant="caption" color="text.secondary">
                {t('hotel.staff.noAssignments')}
              </Typography>
            ) : (
              <Stack spacing={1.5}>
                {form.assignments.map((assignment, index) => (
                  <Stack
                    key={assignment.key}
                    direction="row"
                    spacing={1.5}
                    alignItems="center"
                    data-testid={`staff-assignment-${index}`}
                    sx={{ p: 1.5, borderRadius: 2, bgcolor: 'brand.surfaceMuted' }}
                  >
                    <TextField
                      select
                      size="small"
                      label={t('hotel.staff.department')}
                      value={assignment.execution_point_id}
                      onChange={(event) =>
                        patchAssignment(assignment.key, { execution_point_id: event.target.value })
                      }
                      SelectProps={{ native: true }}
                      InputLabelProps={{ shrink: true }}
                      inputProps={{ 'data-testid': `staff-assignment-point-${index}` }}
                      sx={{ flexGrow: 1 }}
                    >
                      {departments.map((department) => (
                        <option key={department.id} value={department.id}>
                          {departmentLabel(department)}
                        </option>
                      ))}
                    </TextField>
                    <TextField
                      select
                      size="small"
                      label={t('hotel.staff.level')}
                      value={assignment.level}
                      onChange={(event) =>
                        patchAssignment(assignment.key, { level: event.target.value as StaffLevel })
                      }
                      SelectProps={{ native: true }}
                      InputLabelProps={{ shrink: true }}
                      inputProps={{ 'data-testid': `staff-assignment-level-${index}` }}
                      sx={{ minWidth: 160 }}
                    >
                      {STAFF_LEVELS.map((level) => (
                        <option key={level} value={level}>
                          {t(`hotel.staff.levels.${level}`)}
                        </option>
                      ))}
                    </TextField>
                    <IconButton
                      size="small"
                      aria-label={t('common.delete')}
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          assignments: prev.assignments.filter((entry) => entry.key !== assignment.key),
                        }))
                      }
                      data-testid={`staff-assignment-remove-${index}`}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                ))}
              </Stack>
            )}
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          disabled={emailInvalid || passwordInvalid || mutation.isPending}
          onClick={() => mutation.mutate()}
          data-testid="staff-save"
        >
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
