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
import { ModifierGroupsEditor } from './ModifierGroupsEditor';
import {
  groupsToDrafts,
  syncModifierGroups,
  validateGroups,
  type DraftGroup,
} from './modifierDrafts';

interface ItemForm {
  category_id: string;
  title: Translated;
  description: Translated;
  priceInput: string;
  is_active: boolean;
  in_stock: boolean;
  flags: string[];
  allergens: string[];
  schedule_id: string | null;
}

function emptyForm(categoryId: string): ItemForm {
  return {
    category_id: categoryId,
    title: {},
    description: {},
    priceInput: '0.00',
    is_active: true,
    in_stock: true,
    flags: [],
    allergens: [],
    schedule_id: null,
  };
}

function formFromItem(item: Item, minorUnits: number): ItemForm {
  return {
    category_id: item.category_id,
    title: { ...item.title },
    description: { ...(item.description ?? {}) },
    priceInput: minorToInput(item.price, minorUnits),
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
    emptyForm(searchParams.get('category_id') ?? ''),
  );
  const [images, setImages] = useState<EditableImage[]>([]);
  const [groups, setGroups] = useState<DraftGroup[]>([]);
  const [baseline, setBaseline] = useState<string>('');
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [activeLanguage, setActiveLanguage] = useState<string | undefined>();
  const dirtyRef = useRef(false);
  const hydratedIdRef = useRef<string | null>(null);

  /** Snapshot used for the "unsaved changes" indicator. */
  const snapshot = useMemo(
    () => JSON.stringify({ form, images: persistableImageIds(images), groups }),
    [form, images, groups],
  );

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
    setForm(nextForm);
    setImages(nextImages);
    setGroups(nextGroups);
    setBaseline(
      JSON.stringify({
        form: nextForm,
        images: nextImages.map((image) => image.id),
        groups: nextGroups,
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
    setBaseline(JSON.stringify({ form, images: [], groups: [] }));
  }, [isNew, baseline, form]);

  const isDirty = baseline !== '' && snapshot !== baseline;
  dirtyRef.current = isDirty;

  /* ── Validation ─────────────────────────────────────────────────────── */

  const parsePrice = useCallback(
    (value: string) => inputToMinor(value, minorUnits),
    [minorUnits],
  );

  const priceMinor = parsePrice(form.priceInput);

  const fieldErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    if (!form.category_id) errors.category_id = t('validation.categoryRequired');
    if (!form.title[languages.defaultCode]?.trim()) {
      errors.title = t('validation.titleRequiredIn', {
        language: languages.labels[languages.defaultCode] ?? languages.defaultCode,
      });
    }
    if (priceMinor === null) errors.price = t('validation.priceInvalid');
    else if (priceMinor < 0) errors.price = t('validation.priceNegative');
    return { ...errors, ...serverErrors };
  }, [form, languages, priceMinor, serverErrors, t]);

  const modifierErrors = useMemo(() => {
    const grouped: Record<string, Record<string, string>> = {};
    for (const error of validateGroups(groups, languages.defaultCode, parsePrice)) {
      grouped[error.target] = {
        ...grouped[error.target],
        [error.field]: t(error.messageKey),
      };
    }
    return grouped;
  }, [groups, languages.defaultCode, parsePrice, t]);

  const isValid =
    Object.keys(fieldErrors).length === 0 && Object.keys(modifierErrors).length === 0;

  /* ── Save ───────────────────────────────────────────────────────────── */

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        category_id: form.category_id,
        title: compactTranslated(form.title),
        description: compactTranslated(form.description),
        price: priceMinor ?? 0,
        flags: form.flags,
        allergens: form.allergens,
        schedule_id: form.schedule_id,
        is_active: form.is_active,
        in_stock: form.in_stock,
      };

      const saved = itemId
        ? await updateItem(itemId, payload)
        : await createItem(payload);

      const imageIds = persistableImageIds(images);
      const originalImageIds = (itemQuery.data?.images ?? []).map((image) => image.id);
      if (
        imageIds.length !== originalImageIds.length ||
        imageIds.some((id, index) => id !== originalImageIds[index])
      ) {
        await putItemImages(saved.id, imageIds);
      }

      await syncModifierGroups(
        saved.id,
        groups,
        itemQuery.data?.modifier_groups ?? [],
        (value) => parsePrice(value) ?? 0,
      );

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

                <TranslatedField
                  label={t('item.title')}
                  value={form.title}
                  onChange={(title) => setForm((prev) => ({ ...prev, title }))}
                  languages={languages.codes}
                  languageLabels={languages.labels}
                  defaultLanguage={languages.defaultCode}
                  required
                  error={fieldErrors.title}
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
                    error={Boolean(fieldErrors.category_id)}
                    helperText={fieldErrors.category_id}
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

                  <TextField
                    size="small"
                    label={t('item.price')}
                    value={form.priceInput}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, priceInput: event.target.value }))
                    }
                    error={Boolean(fieldErrors.price)}
                    helperText={fieldErrors.price ?? t('item.priceHint')}
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

          {/* Modifiers */}
          <Card variant="outlined" sx={{ borderColor: 'divider' }}>
            <CardContent>
              <ModifierGroupsEditor
                groups={groups}
                onChange={setGroups}
                languages={languages.codes}
                languageLabels={languages.labels}
                defaultLanguage={languages.defaultCode}
                currencySymbol={currency}
                errors={modifierErrors}
              />
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
