import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Checkbox from '@mui/material/Checkbox';
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
import { fetchCategories } from '@/api/cms';
import {
  createLocation,
  deleteLocation,
  fetchLocationMatrix,
  fetchLocations,
  updateLocation,
  updateLocationMatrix,
} from '@/api/hotelAdmin';
import {
  DELIVERY_MODES,
  type DeliveryMode,
  type HotelLocation,
  type LocationKind,
  type MatrixCell,
} from '@/api/hotelAdminTypes';
import { queryKeys } from '@/api/queryKeys';
import type { Translated } from '@/api/types';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { SchedulePicker } from '@/components/SchedulePicker';
import { TranslatedField } from '@/components/TranslatedField';
import { useToast } from '@/components/ToastProvider';
import { useBootstrap, useContentLanguages } from '@/hooks/useBootstrap';
import { flattenCategories } from '@/utils/categories';
import { currencySymbol, inputToMinor, minorToInput } from '@/utils/money';
import { compactTranslated, pickTranslated } from '@/utils/translated';

const LOCATION_KINDS: LocationKind[] = ['in_room', 'common_point'];

interface LocationForm {
  kind: LocationKind;
  title: Translated;
  requires_refinement: boolean;
  refinement_label: Translated;
  schedule_id: string | null;
  sort_order: number;
  is_active: boolean;
  /** Money as a text input (major units); converted to minor on save. */
  deliveryFeeInput: string;
}

const EMPTY_FORM: LocationForm = {
  kind: 'common_point',
  title: {},
  requires_refinement: false,
  refinement_label: {},
  schedule_id: null,
  sort_order: 0,
  is_active: true,
  deliveryFeeInput: '0',
};

export function LocationsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: bootstrap } = useBootstrap();
  const languages = useContentLanguages(bootstrap);

  const [editing, setEditing] = useState<HotelLocation | 'new' | null>(null);
  const [pendingDelete, setPendingDelete] = useState<HotelLocation | null>(null);

  const locationsQuery = useQuery({ queryKey: queryKeys.locations, queryFn: fetchLocations });
  const locations = locationsQuery.data ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.locations });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteLocation(id),
    onSuccess: () => {
      toast.show(t('hotel.locations.deleted'), 'success');
      setPendingDelete(null);
      void invalidate();
      void queryClient.invalidateQueries({ queryKey: queryKeys.locationMatrix });
    },
    onError: (error) =>
      toast.show(error instanceof ApiError ? error.detail : t('errors.generic'), 'error'),
  });

  const title = (location: HotelLocation) =>
    pickTranslated(location.title, languages.displayLanguage, languages.defaultCode) ||
    location.code;

  return (
    <Box sx={{ p: 3 }}>
      <Stack spacing={3}>
        <Card variant="outlined" sx={{ borderColor: 'divider' }}>
          <CardContent sx={{ p: 2 }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
              <Stack>
                <Typography variant="h5">{t('hotel.locations.title')}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('hotel.locations.subtitle')}
                </Typography>
              </Stack>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setEditing('new')}
                data-testid="location-add"
              >
                {t('hotel.locations.add')}
              </Button>
            </Stack>
            <Divider sx={{ mb: 1 }} />

            {locationsQuery.isLoading ? (
              <Stack spacing={1}>
                {[0, 1, 2].map((key) => (
                  <Skeleton key={key} variant="rounded" height={44} />
                ))}
              </Stack>
            ) : locationsQuery.isError ? (
              <Alert severity="error">{t('hotel.locations.loadError')}</Alert>
            ) : locations.length === 0 ? (
              <EmptyState
                testId="locations-empty"
                title={t('hotel.locations.empty')}
                description={t('hotel.locations.emptyHint')}
                action={
                  <Button variant="contained" size="small" onClick={() => setEditing('new')}>
                    {t('hotel.locations.add')}
                  </Button>
                }
              />
            ) : (
              <Box data-testid="locations-list">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('hotel.locations.name')}</TableCell>
                      <TableCell>{t('hotel.locations.kind')}</TableCell>
                      <TableCell>{t('hotel.locations.refinement')}</TableCell>
                      <TableCell>{t('hotel.locations.active')}</TableCell>
                      <TableCell align="right">{t('common.actions')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {locations.map((location) => (
                      <TableRow key={location.id} hover data-testid={`location-row-${location.code}`}>
                        <TableCell>
                          <Typography variant="body2" fontWeight={500}>
                            {title(location)}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip size="small" label={t(`hotel.locations.kinds.${location.kind}`)} />
                        </TableCell>
                        <TableCell>
                          {location.requires_refinement
                            ? pickTranslated(
                                location.refinement_label,
                                languages.displayLanguage,
                                languages.defaultCode,
                              ) || t('common.on')
                            : '—'}
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            variant={location.is_active ? 'filled' : 'outlined'}
                            color={location.is_active ? 'success' : 'default'}
                            label={location.is_active ? t('common.on') : t('common.off')}
                          />
                        </TableCell>
                        <TableCell align="right">
                          <IconButton
                            size="small"
                            onClick={() => setEditing(location)}
                            aria-label={t('common.edit')}
                            data-testid={`location-edit-${location.code}`}
                          >
                            <EditOutlinedIcon fontSize="small" />
                          </IconButton>
                          <IconButton
                            size="small"
                            onClick={() => setPendingDelete(location)}
                            aria-label={t('common.delete')}
                            data-testid={`location-delete-${location.code}`}
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

        <LocationMatrix languages={languages} />
      </Stack>

      {editing ? (
        <LocationDialog
          location={editing === 'new' ? null : editing}
          schedules={bootstrap?.schedules ?? []}
          dayParts={bootstrap?.day_parts ?? []}
          languages={languages}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void invalidate();
            void queryClient.invalidateQueries({ queryKey: queryKeys.locationMatrix });
          }}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        testId="location-delete-dialog"
        destructive
        busy={deleteMutation.isPending}
        title={t('hotel.locations.deleteTitle')}
        description={t('hotel.locations.deleteBody', {
          name: pendingDelete ? title(pendingDelete) : '',
        })}
        confirmLabel={t('common.delete')}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
      />
    </Box>
  );
}

/* ── Location editor dialog ────────────────────────────────────────────── */

function LocationDialog({
  location,
  schedules,
  dayParts,
  languages,
  onClose,
  onSaved,
}: {
  location: HotelLocation | null;
  schedules: import('@/api/types').Schedule[];
  dayParts: string[];
  languages: ReturnType<typeof useContentLanguages>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const { data: bootstrap } = useBootstrap();
  const minorUnits = bootstrap?.hotel?.currency_minor_units ?? 2;
  const currency = bootstrap?.hotel?.currency ?? 'RUB';

  const [form, setForm] = useState<LocationForm>(
    location
      ? {
          kind: location.kind,
          title: { ...location.title },
          requires_refinement: location.requires_refinement,
          refinement_label: { ...(location.refinement_label ?? {}) },
          schedule_id: location.schedule_id ?? null,
          sort_order: location.sort_order,
          is_active: location.is_active,
          deliveryFeeInput: minorToInput(location.delivery_fee_minor ?? 0, minorUnits),
        }
      : EMPTY_FORM,
  );
  const [serverError, setServerError] = useState<string | null>(null);

  const titleMissing = !form.title[languages.defaultCode]?.trim();
  const refinementMissing =
    form.requires_refinement && !form.refinement_label[languages.defaultCode]?.trim();
  const deliveryFeeMinor = inputToMinor(form.deliveryFeeInput, minorUnits);
  const deliveryFeeInvalid = deliveryFeeMinor === null || deliveryFeeMinor < 0;

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        kind: form.kind,
        title: compactTranslated(form.title),
        requires_refinement: form.requires_refinement,
        refinement_label: form.requires_refinement
          ? compactTranslated(form.refinement_label)
          : {},
        schedule_id: form.schedule_id,
        sort_order: form.sort_order,
        is_active: form.is_active,
        delivery_fee_minor: deliveryFeeMinor ?? 0,
      };
      return location ? updateLocation(location.id, payload) : createLocation(payload);
    },
    onSuccess: () => {
      toast.show(t('hotel.locations.saved'), 'success');
      onSaved();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'refinement_label_required') {
        setServerError(t('hotel.locations.refinementRequired'));
        return;
      }
      setServerError(error instanceof ApiError ? error.detail : t('errors.generic'));
    },
  });

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth data-testid="location-dialog">
      <DialogTitle>
        {location ? t('hotel.locations.editTitle') : t('hotel.locations.newTitle')}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          {serverError ? <Alert severity="error">{serverError}</Alert> : null}

          <TranslatedField
            label={t('hotel.locations.name')}
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
            testId="location-title"
          />

          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            <TextField
              select
              size="small"
              label={t('hotel.locations.kind')}
              value={form.kind}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, kind: event.target.value as LocationKind }))
              }
              sx={{ minWidth: 200 }}
              inputProps={{ 'data-testid': 'location-kind' }}
            >
              {LOCATION_KINDS.map((kind) => (
                <MenuItem key={kind} value={kind}>
                  {t(`hotel.locations.kinds.${kind}`)}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              size="small"
              type="number"
              label={t('hotel.locations.sortOrder')}
              value={form.sort_order}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, sort_order: Number(event.target.value) }))
              }
              sx={{ width: 140 }}
              inputProps={{ 'data-testid': 'location-sort' }}
            />

            {/* Стоимость доставки в эту локацию; порог бесплатной — на
                уровне отеля, в настройках коммерции. */}
            <TextField
              size="small"
              label={t('hotel.locations.deliveryFee')}
              value={form.deliveryFeeInput}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, deliveryFeeInput: event.target.value }))
              }
              error={deliveryFeeInvalid}
              helperText={deliveryFeeInvalid ? t('hotel.locations.deliveryFeeInvalid') : undefined}
              InputProps={{ endAdornment: currencySymbol(currency, languages.displayLanguage) }}
              sx={{ width: 180 }}
              inputProps={{ 'data-testid': 'cms-location-delivery-fee', inputMode: 'decimal' }}
            />

            <FormControlLabel
              control={
                <Switch
                  checked={form.is_active}
                  onChange={(event) => setForm((prev) => ({ ...prev, is_active: event.target.checked }))}
                />
              }
              label={t('hotel.locations.active')}
            />
          </Stack>

          <FormControlLabel
            control={
              <Switch
                checked={form.requires_refinement}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, requires_refinement: event.target.checked }))
                }
                inputProps={{ 'data-testid': 'location-requires-refinement' } as Record<string, string>}
              />
            }
            label={t('hotel.locations.requiresRefinement')}
          />

          {/* The refinement label only makes sense when refinement is on. */}
          {form.requires_refinement ? (
            <TranslatedField
              label={t('hotel.locations.refinementLabel')}
              value={form.refinement_label}
              onChange={(refinement_label) => setForm((prev) => ({ ...prev, refinement_label }))}
              languages={languages.codes}
              languageLabels={languages.labels}
              defaultLanguage={languages.defaultCode}
              required
              error={
                refinementMissing
                  ? t('validation.titleRequiredIn', {
                      language: languages.labels[languages.defaultCode] ?? languages.defaultCode,
                    })
                  : undefined
              }
              testId="location-refinement-label"
            />
          ) : null}

          <Box>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
              {t('schedule.section')}
            </Typography>
            <SchedulePicker
              value={form.schedule_id}
              onChange={(schedule_id) => setForm((prev) => ({ ...prev, schedule_id }))}
              schedules={schedules}
              dayParts={dayParts}
              testId="location-schedule"
            />
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          disabled={titleMissing || refinementMissing || deliveryFeeInvalid || mutation.isPending}
          onClick={() => mutation.mutate()}
          data-testid="location-save"
        >
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ── Category → location matrix ────────────────────────────────────────── */

function normalizeCells(rowCells: MatrixCell[], locationIds: string[]): MatrixCell[] {
  const byId = new Map(rowCells.map((cell) => [cell.location_id, cell]));
  return locationIds.map(
    (id) =>
      byId.get(id) ?? { location_id: id, enabled: false, delivery_modes: [] as DeliveryMode[] },
  );
}

function LocationMatrix({ languages }: { languages: ReturnType<typeof useContentLanguages> }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const toast = useToast();

  const matrixQuery = useQuery({
    queryKey: queryKeys.locationMatrix,
    queryFn: fetchLocationMatrix,
  });
  const categoriesQuery = useQuery({
    queryKey: queryKeys.categories,
    queryFn: fetchCategories,
  });

  // Local edits per category row: they override server data so a background
  // refetch never wipes an in-progress edit.
  const [drafts, setDrafts] = useState<Record<string, MatrixCell[]>>({});
  const [savingRow, setSavingRow] = useState<string | null>(null);

  const categoryCodes = useMemo(() => {
    const map = new Map<string, string>();
    for (const { category } of flattenCategories(categoriesQuery.data ?? [])) {
      map.set(category.id, category.code);
    }
    return map;
  }, [categoriesQuery.data]);

  const matrix = matrixQuery.data;
  const locationIds = matrix?.locations.map((location) => location.id) ?? [];

  const saveMutation = useMutation({
    mutationFn: (categoryId: string) =>
      updateLocationMatrix({ category_id: categoryId, cells: drafts[categoryId] ?? [] }),
    onSuccess: (data, categoryId) => {
      queryClient.setQueryData(queryKeys.locationMatrix, data);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[categoryId];
        return next;
      });
      setSavingRow(null);
      toast.show(t('hotel.matrix.saved'), 'success');
    },
    onError: (error) => {
      setSavingRow(null);
      toast.show(error instanceof ApiError ? error.detail : t('errors.generic'), 'error');
    },
  });

  const cellsFor = (categoryId: string, rowCells: MatrixCell[]): MatrixCell[] =>
    drafts[categoryId] ?? normalizeCells(rowCells, locationIds);

  const patchCell = (categoryId: string, rowCells: MatrixCell[], locationId: string, changes: Partial<MatrixCell>) => {
    const current = cellsFor(categoryId, rowCells);
    setDrafts((prev) => ({
      ...prev,
      [categoryId]: current.map((cell) =>
        cell.location_id === locationId ? { ...cell, ...changes } : cell,
      ),
    }));
  };

  const toggleMode = (cell: MatrixCell, mode: DeliveryMode): DeliveryMode[] =>
    cell.delivery_modes.includes(mode)
      ? cell.delivery_modes.filter((entry) => entry !== mode)
      : [...cell.delivery_modes, mode];

  const locationTitle = (title: Translated, code: string) =>
    pickTranslated(title, languages.displayLanguage, languages.defaultCode) || code;

  return (
    <Card variant="outlined" sx={{ borderColor: 'divider' }}>
      <CardContent sx={{ p: 2 }}>
        <Stack sx={{ mb: 1 }}>
          <Typography variant="h6">{t('hotel.matrix.title')}</Typography>
          <Typography variant="caption" color="text.secondary">
            {t('hotel.matrix.hint')}
          </Typography>
        </Stack>
        <Divider sx={{ mb: 1 }} />

        {matrixQuery.isLoading ? (
          <Skeleton variant="rounded" height={200} />
        ) : matrixQuery.isError ? (
          <Alert severity="error">{t('hotel.matrix.loadError')}</Alert>
        ) : !matrix || matrix.rows.length === 0 || matrix.locations.length === 0 ? (
          <EmptyState testId="matrix-empty" title={t('hotel.matrix.empty')} description={t('hotel.matrix.emptyHint')} />
        ) : (
          <Box sx={{ overflowX: 'auto' }} data-testid="location-matrix">
            <Table size="small" sx={{ minWidth: 640 }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ position: 'sticky', left: 0, bgcolor: 'background.paper', zIndex: 1 }}>
                    {t('hotel.matrix.category')}
                  </TableCell>
                  {matrix.locations.map((location) => (
                    <TableCell key={location.id} align="center">
                      {locationTitle(location.title, location.code)}
                    </TableCell>
                  ))}
                  <TableCell align="right">{t('common.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {matrix.rows.map((row) => {
                  const cells = cellsFor(row.category_id, row.cells);
                  const dirty = Boolean(drafts[row.category_id]);
                  const catCode = categoryCodes.get(row.category_id) ?? row.category_id;
                  const rowTitle =
                    typeof row.category_title === 'string'
                      ? row.category_title
                      : pickTranslated(row.category_title, languages.displayLanguage, languages.defaultCode);
                  return (
                    <TableRow key={row.category_id} hover>
                      <TableCell sx={{ position: 'sticky', left: 0, bgcolor: 'background.paper' }}>
                        <Typography variant="body2" fontWeight={500}>
                          {rowTitle || catCode}
                        </Typography>
                      </TableCell>
                      {matrix.locations.map((location) => {
                        const cell =
                          cells.find((entry) => entry.location_id === location.id) ?? {
                            location_id: location.id,
                            enabled: false,
                            delivery_modes: [],
                          };
                        const locCode = location.code;
                        return (
                          <TableCell
                            key={location.id}
                            align="center"
                            data-testid={`matrix-cell-${catCode}-${locCode}`}
                          >
                            <Stack spacing={0.5} alignItems="center">
                              <Checkbox
                                size="small"
                                checked={cell.enabled}
                                onChange={(event) =>
                                  patchCell(row.category_id, row.cells, location.id, {
                                    enabled: event.target.checked,
                                  })
                                }
                                inputProps={
                                  {
                                    'data-testid': `matrix-cell-${catCode}-${locCode}-enabled`,
                                  } as Record<string, string>
                                }
                              />
                              {cell.enabled ? (
                                <Stack direction="row" spacing={0.5}>
                                  {DELIVERY_MODES.map((mode) => (
                                    <Chip
                                      key={mode}
                                      size="small"
                                      label={t(`hotel.matrix.modes.${mode}`)}
                                      color={cell.delivery_modes.includes(mode) ? 'primary' : 'default'}
                                      variant={cell.delivery_modes.includes(mode) ? 'filled' : 'outlined'}
                                      onClick={() =>
                                        patchCell(row.category_id, row.cells, location.id, {
                                          delivery_modes: toggleMode(cell, mode),
                                        })
                                      }
                                      data-testid={`matrix-cell-${catCode}-${locCode}-${mode}`}
                                    />
                                  ))}
                                </Stack>
                              ) : null}
                            </Stack>
                          </TableCell>
                        );
                      })}
                      <TableCell align="right">
                        <Button
                          size="small"
                          variant="contained"
                          disabled={!dirty || saveMutation.isPending}
                          onClick={() => {
                            setSavingRow(row.category_id);
                            saveMutation.mutate(row.category_id);
                          }}
                          data-testid={`matrix-save-${catCode}`}
                        >
                          {savingRow === row.category_id ? t('common.saving') : t('common.save')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
