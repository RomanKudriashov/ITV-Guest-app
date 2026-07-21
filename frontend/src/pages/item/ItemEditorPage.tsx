import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

import { ApiError } from '@/api/client';
import {
  createItem,
  fetchCategories,
  fetchItem,
  putItemImages,
  updateItem,
} from '@/api/cms';
import { queryKeys } from '@/api/queryKeys';
import type { Item, Translated } from '@/api/types';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  ImageUploader,
  mediaToEditable,
  persistableImageIds,
  type EditableImage,
} from '@/components/ImageUploader';
import { SchedulePicker } from '@/components/SchedulePicker';
import { TranslatedField } from '@/components/TranslatedField';
import { useToast } from '@/components/ToastProvider';
import { useBootstrap, useContentLanguages } from '@/hooks/useBootstrap';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { flattenCategories } from '@/utils/categories';
import { currencySymbol, inputToMinor, minorToInput } from '@/utils/money';
import { compactTranslated, pickTranslated } from '@/utils/translated';
import {
  LOCATION_MODES,
  behaviourFor,
  isLocationMode,
  isOfferingType,
  OFFERING_TYPES,
  type LocationMode,
  type OfferingType,
} from '@/offerings/behaviour';
import { ModifierGroupsEditor } from './ModifierGroupsEditor';
import { RequestFieldsEditor } from './RequestFieldsEditor';
import {
  groupsToDrafts,
  syncModifierGroups,
  validateGroups,
  type DraftGroup,
} from './modifierDrafts';
import {
  fieldsToDrafts,
  syncRequestFields,
  validateFields,
  type DraftField,
} from './requestFieldDrafts';

interface ItemForm {
  category_id: string;
  /** Chosen at creation, immutable afterwards (`422 type_immutable`). */
  type: OfferingType;
  location_mode: LocationMode;
  title: Translated;
  description: Translated;
  /** Kept as typed text; an empty box means "price not set", not zero. */
  priceInput: string;
  is_active: boolean;
  in_stock: boolean;
  flags: string[];
  allergens: string[];
  schedule_id: string | null;
}

function emptyForm(categoryId: string, type: OfferingType = 'product'): ItemForm {
  const behaviour = behaviourFor(type);
  return {
    category_id: categoryId,
    type,
    location_mode: behaviour.defaultLocationMode,
    title: {},
    description: {},
    // An unpriced offering is normal for a service, so it starts empty there.
    priceInput: behaviour.priced === 'optional' ? '' : '0.00',
    is_active: true,
    in_stock: true,
    flags: [],
    allergens: [],
    schedule_id: null,
  };
}

function formFromItem(item: Item, minorUnits: number): ItemForm {
  const type = isOfferingType(item.type) ? item.type : 'product';
  return {
    category_id: item.category_id,
    type,
    location_mode: isLocationMode(item.location_mode)
      ? item.location_mode
      : behaviourFor(type).defaultLocationMode,
    title: { ...item.title },
    description: { ...(item.description ?? {}) },
    priceInput: item.price === null || item.price === undefined
      ? ''
      : minorToInput(item.price, minorUnits),
    is_active: item.is_active,
    in_stock: item.in_stock,
    flags: [...(item.flags ?? [])],
    allergens: [...(item.allergens ?? [])],
    schedule_id: item.schedule_id ?? null,
  };
}

export function ItemEditorPage() {
  const { t } = useTranslation();
  const { id: routeId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [itemId, setItemId] = useState<string | null>(routeId ?? null);
  const isNew = !itemId;

  const { data: bootstrap, isLoading: bootstrapLoading } = useBootstrap();
  const languages = useContentLanguages(bootstrap);
  const minorUnits = bootstrap?.hotel.currency_minor_units ?? 100;

  const categoriesQuery = useQuery({
    queryKey: queryKeys.categories,
    queryFn: fetchCategories,
  });
  const flatCategories = useMemo(
    () => flattenCategories(categoriesQuery.data ?? []),
    [categoriesQuery.data],
  );

  const itemQuery = useQuery({
    queryKey: queryKeys.item(itemId ?? ''),
    queryFn: () => fetchItem(itemId as string),
    enabled: Boolean(itemId),
  });

  const [form, setForm] = useState<ItemForm>(() =>
    emptyForm(
      searchParams.get('category_id') ?? '',
      isOfferingType(searchParams.get('type')) ? (searchParams.get('type') as OfferingType) : 'product',
    ),
  );
  const [images, setImages] = useState<EditableImage[]>([]);
  const [groups, setGroups] = useState<DraftGroup[]>([]);
  const [fields, setFields] = useState<DraftField[]>([]);
  const [baseline, setBaseline] = useState<string>('');
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [activeLanguage, setActiveLanguage] = useState<string | undefined>();
  const dirtyRef = useRef(false);
  const hydratedIdRef = useRef<string | null>(null);

  /** Snapshot used for the "unsaved changes" indicator. */
  const snapshot = useMemo(
    () => JSON.stringify({ form, images: persistableImageIds(images), groups, fields }),
    [form, images, groups, fields],
  );

  /**
   * The ONE switch of this editor. Which body an item has — modifier groups or
   * request fields — and whether its price may be empty is read from the
   * behaviour registry, not decided by conditions scattered over the form.
   */
  const behaviour = behaviourFor(form.type);

  // Hydrate from the loaded item. A background refetch must not wipe edits, so
  // an already-hydrated dirty form is left alone.
  useEffect(() => {
    const item = itemQuery.data;
    if (!item) return;
    if (hydratedIdRef.current === item.id && dirtyRef.current) return;
    hydratedIdRef.current = item.id;
    const nextForm = formFromItem(item, minorUnits);
    const nextImages = (item.images ?? []).map(mediaToEditable);
    const nextGroups = groupsToDrafts(item.modifier_groups, minorUnits);
    const nextFields = fieldsToDrafts(item.request_fields);
    setForm(nextForm);
    setImages(nextImages);
    setGroups(nextGroups);
    setFields(nextFields);
    setBaseline(
      JSON.stringify({
        form: nextForm,
        images: nextImages.map((image) => image.id),
        groups: nextGroups,
        fields: nextFields,
      }),
    );
  }, [itemQuery.data, minorUnits]);

  // Preselect the category for a brand-new item.
  useEffect(() => {
    if (!isNew || form.category_id || flatCategories.length === 0) return;
    const preset = searchParams.get('category_id');
    setForm((prev) => ({
      ...prev,
      category_id: preset || flatCategories[0].category.id,
    }));
  }, [isNew, form.category_id, flatCategories, searchParams]);

  // Seed the baseline of a new item once its category has been preselected,
  // so the freshly opened form does not immediately look "dirty".
  useEffect(() => {
    if (!isNew || baseline || !form.category_id) return;
    setBaseline(JSON.stringify({ form, images: [], groups: [], fields: [] }));
  }, [isNew, baseline, form]);

  const isDirty = baseline !== '' && snapshot !== baseline;
  dirtyRef.current = isDirty;

  /* ── Validation ─────────────────────────────────────────────────────── */

  const parsePrice = useCallback(
    (value: string) => inputToMinor(value, minorUnits),
    [minorUnits],
  );

  /** An empty box is `null` ("price not set"), not a parse failure. */
  const priceEmpty = !form.priceInput.trim();
  const priceMinor = priceEmpty ? null : parsePrice(form.priceInput);

  const formErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    if (!form.category_id) errors.category_id = t('validation.categoryRequired');
    if (!form.title[languages.defaultCode]?.trim()) {
      errors.title = t('validation.titleRequiredIn', {
        language: languages.labels[languages.defaultCode] ?? languages.defaultCode,
      });
    }
    if (priceEmpty) {
      // "Priced always" vs "priced optionally" is a property of the type, and
      // the registry is the one that knows it.
      if (behaviour.priced === 'always') errors.price = t('validation.priceRequired');
    } else if (priceMinor === null) errors.price = t('validation.priceInvalid');
    else if (priceMinor < 0) errors.price = t('validation.priceNegative');
    return { ...errors, ...serverErrors };
  }, [form, languages, priceEmpty, priceMinor, behaviour, serverErrors, t]);

  const modifierErrors = useMemo(() => {
    const grouped: Record<string, Record<string, string>> = {};
    if (!behaviour.usesModifiers) return grouped;
    for (const error of validateGroups(groups, languages.defaultCode, parsePrice)) {
      grouped[error.target] = {
        ...grouped[error.target],
        [error.field]: t(error.messageKey),
      };
    }
    return grouped;
  }, [behaviour, groups, languages.defaultCode, parsePrice, t]);

  const requestFieldErrors = useMemo(() => {
    const grouped: Record<string, Record<string, string>> = {};
    if (!behaviour.usesFields) return grouped;
    for (const error of validateFields(fields, languages.defaultCode)) {
      grouped[error.target] = {
        ...grouped[error.target],
        [error.field]: t(error.messageKey),
      };
    }
    return grouped;
  }, [behaviour, fields, languages.defaultCode, t]);

  const isValid =
    Object.keys(formErrors).length === 0 &&
    Object.keys(modifierErrors).length === 0 &&
    Object.keys(requestFieldErrors).length === 0;

  /* ── Save ───────────────────────────────────────────────────────────── */

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        category_id: form.category_id,
        title: compactTranslated(form.title),
        description: compactTranslated(form.description),
        location_mode: form.location_mode,
        price: priceMinor,
        flags: form.flags,
        allergens: form.allergens,
        schedule_id: form.schedule_id,
        is_active: form.is_active,
        in_stock: form.in_stock,
      };

      // `type` travels only on creation: the server answers 422 `type_immutable`
      // to a change, and an item that switched type would orphan its body.
      const saved = itemId
        ? await updateItem(itemId, payload)
        : await createItem({ ...payload, type: form.type });

      const imageIds = persistableImageIds(images);
      const originalImageIds = (itemQuery.data?.images ?? []).map((image) => image.id);
      if (
        imageIds.length !== originalImageIds.length ||
        imageIds.some((id, index) => id !== originalImageIds[index])
      ) {
        await putItemImages(saved.id, imageIds);
      }

      // The body an item does not have is never touched: a service has no
      // modifier groups to sync, a dish has no request fields.
      if (behaviour.usesModifiers) {
        await syncModifierGroups(
          saved.id,
          groups,
          itemQuery.data?.modifier_groups ?? [],
          (value) => parsePrice(value) ?? 0,
        );
      }
      if (behaviour.usesFields) {
        await syncRequestFields(saved.id, fields, itemQuery.data?.request_fields ?? []);
      }

      return saved;
    },
    onSuccess: async (saved) => {
      setServerErrors({});
      toast.show(t('item.saved'), 'success');

      // Разблокируем регидратацию. Эффект выше намеренно НЕ перечитывает
      // форму, пока в ней есть несохранённые правки (иначе фоновый refetch
      // затёр бы их) — но после успешного сохранения правок больше нет.
      // Без сброса форма навсегда осталась бы «не сохранена»: свежие данные
      // не могли бы приехать, потому что мешал флаг, который они и снимают.
      // Заодно это подтягивает то, что нормализовал сервер: сгенерированные
      // коды, single ⇒ max_choices=1, required ⇒ min_choices≥1.
      dirtyRef.current = false;
      hydratedIdRef.current = null;
      void queryClient.invalidateQueries({ queryKey: queryKeys.categories });
      void queryClient.invalidateQueries({ queryKey: ['cms', 'items'] });

      if (!itemId) {
        // A new item becomes an existing one — the URL follows.
        setItemId(saved.id);
        navigate(`/cms/menu/items/${saved.id}`, { replace: true });
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.item(saved.id) });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.isValidation && error.field) {
        setServerErrors({ [error.field]: error.detail });
        toast.show(error.detail, 'error');
        return;
      }
      toast.show(error instanceof ApiError ? error.detail : t('errors.generic'), 'error');
    },
  });

  const guard = useUnsavedChangesGuard(isDirty && !saveMutation.isPending);

  const toggleCode = (list: string[], code: string) =>
    list.includes(code) ? list.filter((entry) => entry !== code) : [...list, code];

  if (bootstrapLoading || (itemId && itemQuery.isLoading)) {
    return (
      <Box sx={{ p: 3 }}>
        <Skeleton variant="rounded" height={64} sx={{ mb: 2 }} />
        <Skeleton variant="rounded" height={420} />
      </Box>
    );
  }

  if (!bootstrap) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{t('errors.loadBootstrap')}</Alert>
      </Box>
    );
  }

  if (itemId && itemQuery.isError) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{t('errors.loadItem')}</Alert>
      </Box>
    );
  }

  const currency = currencySymbol(bootstrap.hotel.currency, languages.displayLanguage);

  return (
    <Box sx={{ p: 3, pb: 10 }}>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/cms/menu')}
          data-testid="item-back-button"
        >
          {t('common.back')}
        </Button>
        <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="h5" noWrap>
            {isNew
              ? t('item.newTitle')
              : pickTranslated(form.title, languages.displayLanguage, languages.defaultCode) ||
                t('item.untitled')}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {isDirty ? t('editor.unsaved') : t('editor.saved')}
          </Typography>
        </Stack>
        {isDirty ? (
          <Chip size="small" color="warning" label={t('editor.unsavedBadge')} data-testid="item-dirty-badge" />
        ) : null}
        <Button
          variant="contained"
          size="large"
          disabled={!isValid || !isDirty || saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
          data-testid="item-save-button"
          startIcon={
            saveMutation.isPending ? <CircularProgress size={16} color="inherit" /> : undefined
          }
        >
          {t('common.save')}
        </Button>
      </Stack>

      <Stack direction="row" spacing={3} alignItems="flex-start">
        <Stack spacing={3} sx={{ flexGrow: 1, minWidth: 0 }}>
          {/* Basics */}
          <Card variant="outlined" sx={{ borderColor: 'divider' }}>
            <CardContent>
              <Stack spacing={2.5}>
                <Typography variant="subtitle1">{t('item.basics')}</Typography>

                {/*
                  Type is picked once, at creation. Afterwards the control stays
                  visible but disabled: the editor must SHOW what kind of item
                  this is, and the server refuses to change it anyway.
                */}
                <Stack spacing={0.5}>
                  <Typography variant="caption" color="text.secondary">
                    {t('item.type')}
                  </Typography>
                  <ToggleButtonGroup
                    exclusive
                    size="small"
                    color="primary"
                    value={form.type}
                    disabled={!isNew}
                    onChange={(_event, value: OfferingType | null) => {
                      if (!value) return;
                      setForm((prev) => ({
                        ...prev,
                        type: value,
                        // The default comes from the registry; the hotel may
                        // still override it right below.
                        location_mode: behaviourFor(value).defaultLocationMode,
                        priceInput:
                          behaviourFor(value).priced === 'optional' ? '' : prev.priceInput,
                      }));
                    }}
                  >
                    {OFFERING_TYPES.map((type) => (
                      <ToggleButton
                        key={type}
                        value={type}
                        data-testid={`cms-item-type-${type}`}
                        sx={{ minHeight: 40, px: 2 }}
                      >
                        {t(`item.types.${type}`)}
                      </ToggleButton>
                    ))}
                  </ToggleButtonGroup>
                  <Typography variant="caption" color="text.secondary">
                    {isNew ? t('item.typeHint') : t('item.typeLocked')}
                  </Typography>
                </Stack>

                <TranslatedField
                  label={t('item.title')}
                  value={form.title}
                  onChange={(title) => setForm((prev) => ({ ...prev, title }))}
                  languages={languages.codes}
                  languageLabels={languages.labels}
                  defaultLanguage={languages.defaultCode}
                  required
                  error={formErrors.title}
                  testId="item-title-input"
                  activeLanguage={activeLanguage}
                  onActiveLanguageChange={setActiveLanguage}
                />

                <TranslatedField
                  label={t('item.description')}
                  value={form.description}
                  onChange={(description) => setForm((prev) => ({ ...prev, description }))}
                  languages={languages.codes}
                  languageLabels={languages.labels}
                  defaultLanguage={languages.defaultCode}
                  multiline
                  testId="item-description-input"
                  activeLanguage={activeLanguage}
                  onActiveLanguageChange={setActiveLanguage}
                />

                <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
                  <TextField
                    select
                    size="small"
                    label={t('item.category')}
                    value={form.category_id}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, category_id: event.target.value }))
                    }
                    error={Boolean(formErrors.category_id)}
                    helperText={formErrors.category_id}
                    sx={{ minWidth: 260 }}
                    inputProps={{ 'data-testid': 'item-category-select' }}
                  >
                    {flatCategories.map(({ category, depth }) => (
                      <MenuItem key={category.id} value={category.id}>
                        {`${' '.repeat(depth * 3)}${
                          pickTranslated(
                            category.title,
                            languages.displayLanguage,
                            languages.defaultCode,
                          ) || category.code
                        }`}
                      </MenuItem>
                    ))}
                  </TextField>

                  {/* Native select: the value is a short enum and the OS picker
                      is both simpler and testable. */}
                  <TextField
                    select
                    size="small"
                    label={t('item.locationMode')}
                    value={form.location_mode}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        location_mode: event.target.value as LocationMode,
                      }))
                    }
                    helperText={t(`item.locationModes.${form.location_mode}Hint`)}
                    sx={{ minWidth: 220 }}
                    SelectProps={{ native: true }}
                    InputLabelProps={{ shrink: true }}
                    inputProps={{ 'data-testid': 'cms-location-mode' }}
                  >
                    {LOCATION_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {t(`item.locationModes.${mode}`)}
                      </option>
                    ))}
                  </TextField>

                  <TextField
                    size="small"
                    label={t('item.price')}
                    value={form.priceInput}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, priceInput: event.target.value }))
                    }
                    error={Boolean(formErrors.price)}
                    helperText={
                      formErrors.price ??
                      (behaviour.priced === 'optional'
                        ? t('item.priceOptionalHint')
                        : t('item.priceHint'))
                    }
                    sx={{ width: 200 }}
                    InputProps={{
                      endAdornment: <InputAdornment position="end">{currency}</InputAdornment>,
                    }}
                    inputProps={{ 'data-testid': 'item-price-input', inputMode: 'decimal' }}
                  />

                  <FormControlLabel
                    control={
                      <Switch
                        checked={form.is_active}
                        onChange={(event) =>
                          setForm((prev) => ({ ...prev, is_active: event.target.checked }))
                        }
                        inputProps={
                          { 'data-testid': 'item-active-switch' } as Record<string, string>
                        }
                      />
                    }
                    label={t('item.active')}
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        color="success"
                        checked={form.in_stock}
                        onChange={(event) =>
                          setForm((prev) => ({ ...prev, in_stock: event.target.checked }))
                        }
                        inputProps={
                          { 'data-testid': 'item-stock-switch' } as Record<string, string>
                        }
                      />
                    }
                    label={t('item.inStock')}
                  />
                </Stack>
              </Stack>
            </CardContent>
          </Card>

          {/*
            Item body — ONE card, two possible contents, chosen by the registry
            flags and nothing else. A dish is configured with modifier groups, a
            service with the fields of its request form.
          */}
          <Card variant="outlined" sx={{ borderColor: 'divider' }}>
            <CardContent>
              {behaviour.usesModifiers ? (
                <ModifierGroupsEditor
                  groups={groups}
                  onChange={setGroups}
                  languages={languages.codes}
                  languageLabels={languages.labels}
                  defaultLanguage={languages.defaultCode}
                  currencySymbol={currency}
                  errors={modifierErrors}
                />
              ) : null}
              {behaviour.usesFields ? (
                <RequestFieldsEditor
                  fields={fields}
                  onChange={setFields}
                  languages={languages.codes}
                  languageLabels={languages.labels}
                  defaultLanguage={languages.defaultCode}
                  errors={requestFieldErrors}
                />
              ) : null}
            </CardContent>
          </Card>
        </Stack>

        {/* Side column */}
        <Stack spacing={3} sx={{ width: 380, flexShrink: 0 }}>
          <Card variant="outlined" sx={{ borderColor: 'divider' }}>
            <CardContent>
              <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
                {t('item.photos')}
              </Typography>
              <ImageUploader value={images} onChange={setImages} kind="item" />
            </CardContent>
          </Card>

          <Card variant="outlined" sx={{ borderColor: 'divider' }}>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="subtitle1">{t('item.flags')}</Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {bootstrap.flags.map((flag) => {
                    const selected = form.flags.includes(flag.code);
                    return (
                      <Chip
                        key={flag.code}
                        label={
                          pickTranslated(
                            flag.title,
                            languages.displayLanguage,
                            languages.defaultCode,
                          ) || flag.code
                        }
                        color={selected ? 'primary' : 'default'}
                        variant={selected ? 'filled' : 'outlined'}
                        onClick={() =>
                          setForm((prev) => ({ ...prev, flags: toggleCode(prev.flags, flag.code) }))
                        }
                        data-testid={`item-flag-${flag.code}`}
                      />
                    );
                  })}
                  {bootstrap.flags.length === 0 ? (
                    <Typography variant="caption" color="text.secondary">
                      {t('item.noFlags')}
                    </Typography>
                  ) : null}
                </Stack>

                <Divider />

                <Typography variant="subtitle1">{t('item.allergens')}</Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {bootstrap.allergens.map((allergen) => {
                    const selected = form.allergens.includes(allergen.code);
                    return (
                      <Chip
                        key={allergen.code}
                        label={
                          pickTranslated(
                            allergen.title,
                            languages.displayLanguage,
                            languages.defaultCode,
                          ) || allergen.code
                        }
                        color={selected ? 'warning' : 'default'}
                        variant={selected ? 'filled' : 'outlined'}
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            allergens: toggleCode(prev.allergens, allergen.code),
                          }))
                        }
                        data-testid={`item-allergen-${allergen.code}`}
                      />
                    );
                  })}
                  {bootstrap.allergens.length === 0 ? (
                    <Typography variant="caption" color="text.secondary">
                      {t('item.noAllergens')}
                    </Typography>
                  ) : null}
                </Stack>
              </Stack>
            </CardContent>
          </Card>

          <Card variant="outlined" sx={{ borderColor: 'divider' }}>
            <CardContent>
              <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
                {t('schedule.section')}
              </Typography>
              <SchedulePicker
                value={form.schedule_id}
                onChange={(schedule_id) => setForm((prev) => ({ ...prev, schedule_id }))}
                schedules={bootstrap.schedules}
                dayParts={bootstrap.day_parts}
                testId="item-schedule-select"
              />
            </CardContent>
          </Card>
        </Stack>
      </Stack>

      <ConfirmDialog
        open={guard.isBlocked}
        testId="unsaved-dialog"
        title={t('editor.leaveTitle')}
        description={t('editor.leaveBody')}
        confirmLabel={t('editor.leaveConfirm')}
        cancelLabel={t('editor.leaveCancel')}
        destructive
        onConfirm={guard.proceed}
        onClose={guard.reset}
      />
    </Box>
  );
}
