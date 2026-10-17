import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { QueryState } from '@/components/QueryState';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputAdornment from '@mui/material/InputAdornment';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { ApiError } from '@/api/client';
import { parentOf } from '@/app/backMap';
import { cmsPath } from '@/app/hostRole';
import { BackLink } from '@/kit/BackLink';
import { fetchService } from '@/cms/services/api';
import { createCategory, fetchCategories, updateCategory } from '@/api/cms';
import { queryKeys } from '@/api/queryKeys';
import type { Category, Translated } from '@/api/types';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  ImageUploader,
  mediaToEditable,
  persistableImageIds,
  type EditableImage,
} from '@/components/ImageUploader';
import { SchedulePicker } from '@/components/SchedulePicker';
import { SelectField } from '@/components/SelectField';
import { TranslatedField } from '@/components/TranslatedField';
import { useToast } from '@/components/ToastProvider';
import { PageContainer } from '@/components/PageContainer';
import { FormCell, FormGrid } from '@/kit/formLayout';
import { useBootstrap, useContentLanguages } from '@/hooks/useBootstrap';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { findCategory, flattenCategories, subtreeIds, type FlatCategory } from '@/utils/categories';
import { currencySymbol, inputToMinor, minorToInput } from '@/utils/money';
import { compactTranslated, pickTranslated } from '@/utils/translated';

interface CategoryForm {
  title: Translated;
  description: Translated;
  parent_id: string | null;
  sort_order: number;
  is_active: boolean;
  schedule_id: string | null;
  /** Commerce: whether the service fee applies to this category. */
  service_fee_applies: boolean;
  /** Commerce: minimum order, major-unit text; empty = no minimum. */
  minOrderInput: string;
}

const EMPTY_FORM: CategoryForm = {
  title: {},
  description: {},
  parent_id: null,
  sort_order: 0,
  is_active: true,
  schedule_id: null,
  service_fee_applies: true,
  minOrderInput: '',
};

const ROOT = '__root__';

/** Варианты категорий: вложенность — родителем во второй строке, а не отступом. */
function categoryOptions(flat: FlatCategory[], title: (category: Category) => string) {
  const path: string[] = [];
  return flat.map(({ category, depth }) => {
    const label = title(category);
    path.length = depth;
    const parent = depth > 0 ? path[depth - 1] : undefined;
    path.push(label);
    return { value: category.id, label, secondary: parent };
  });
}

export function CategoryEditorPage() {
  const { t } = useTranslation();
  const { id: routeId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  /**
   * Заведение, внутри которого нажали «Добавить раздел».
   *
   * Экран редактора один на весь отель, а меню с R4 живёт внутри сервиса —
   * значит принадлежность приходит адресом и никак иначе. Пусто — раздел
   * уровня отеля (прежнее поведение).
   */
  const queryServiceId = searchParams.get('service_id');
  const location = useLocation();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [categoryId, setCategoryId] = useState<string | null>(
    routeId && routeId !== 'new' ? routeId : null,
  );
  const isNew = !categoryId;

  const { data: bootstrap, isLoading: bootstrapLoading } = useBootstrap();
  const languages = useContentLanguages(bootstrap);
  const minorUnits = bootstrap?.hotel.currency_minor_units ?? 100;

  const categoriesQuery = useQuery({
    queryKey: queryKeys.categories,
    queryFn: () => fetchCategories(),
  });
  const tree = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  const current = categoryId ? findCategory(tree, categoryId) : null;
  /*
    ЗАВЕДЕНИЕ РАЗДЕЛА — ИЗ АДРЕСА ИЛИ ИЗ САМОГО РАЗДЕЛА (партия 56).

    Новый раздел знает заведение только адресом; существующий несёт его сам
    (`service_id`/`service_name` с сервера), и прямой заход по ссылке без
    `?service_id` всё равно ведёт «← Меню «<заведение>»», а не в общий список.
  */
  const serviceId = queryServiceId ?? current?.service_id ?? null;
  const knownServiceName =
    current?.service_id === serviceId && current?.service_name
      ? current.service_name
      : flattenCategories(tree).find((row) => row.category.service_id === serviceId && row.category.service_name)
          ?.category.service_name;
  // Имени нет ни у одного раздела (первый раздел заведения) — спросить само
  // заведение; из меню заведения оно уже в кэше.
  const serviceQuery = useQuery({
    queryKey: ['cms', 'service', serviceId],
    queryFn: () => fetchService(serviceId ?? ''),
    enabled: Boolean(serviceId) && !knownServiceName && !categoriesQuery.isLoading,
  });

  const [form, setForm] = useState<CategoryForm>(EMPTY_FORM);
  const [image, setImage] = useState<EditableImage[]>([]);
  const [baseline, setBaseline] = useState('');
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [activeLanguage, setActiveLanguage] = useState<string | undefined>();

  useEffect(() => {
    if (!current) {
      if (isNew && !baseline) {
        setBaseline(JSON.stringify({ form: EMPTY_FORM, image: [] }));
      }
      return;
    }
    const nextForm: CategoryForm = {
      title: { ...current.title },
      description: { ...(current.description ?? {}) },
      parent_id: current.parent_id ?? null,
      sort_order: current.sort_order,
      is_active: current.is_active,
      schedule_id: current.schedule_id ?? null,
      service_fee_applies: current.service_fee_applies ?? true,
      minOrderInput:
        current.min_order_minor === null || current.min_order_minor === undefined
          ? ''
          : minorToInput(current.min_order_minor, minorUnits),
    };
    const nextImage = current.image ? [mediaToEditable(current.image)] : [];
    setForm(nextForm);
    setImage(nextImage);
    setBaseline(JSON.stringify({ form: nextForm, image: nextImage.map((entry) => entry.id) }));
    // `current` identity changes on every tree refetch — key off the id only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, categoriesQuery.dataUpdatedAt]);

  const snapshot = useMemo(
    () => JSON.stringify({ form, image: persistableImageIds(image) }),
    [form, image],
  );
  const isDirty = baseline !== '' && snapshot !== baseline;

  const fieldErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    if (!form.title[languages.defaultCode]?.trim()) {
      errors.title = t('validation.titleRequiredIn', {
        language: languages.labels[languages.defaultCode] ?? languages.defaultCode,
      });
    }
    if (form.minOrderInput.trim()) {
      const minor = inputToMinor(form.minOrderInput, minorUnits);
      if (minor === null || minor < 0) errors.min_order_minor = t('category.minOrderInvalid');
    }
    return { ...errors, ...serverErrors };
  }, [form.title, form.minOrderInput, minorUnits, languages, serverErrors, t]);

  const isValid = Object.keys(fieldErrors).length === 0;

  /** A category may not become a child of its own descendant. */
  const forbiddenParents = useMemo(() => {
    if (!current) return new Set<string>();
    return new Set(subtreeIds(current));
  }, [current]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const imageIds = persistableImageIds(image);
      const payload = {
        title: compactTranslated(form.title),
        description: compactTranslated(form.description),
        parent_id: form.parent_id,
        sort_order: form.sort_order,
        is_active: form.is_active,
        schedule_id: form.schedule_id,
        image_id: imageIds[0] ?? null,
        service_fee_applies: form.service_fee_applies,
        min_order_minor: form.minOrderInput.trim()
          ? inputToMinor(form.minOrderInput, minorUnits)
          : null,
      };
      // `service_id` — только при создании: сменить владельца раздела
      // редактированием нельзя, и PATCH это поле не принимает.
      return categoryId
        ? updateCategory(categoryId, payload)
        : createCategory(serviceId ? { ...payload, service_id: serviceId } : payload);
    },
    onSuccess: async (saved: Category) => {
      setServerErrors({});
      toast.show(t('category.saved'), 'success');
      await queryClient.invalidateQueries({ queryKey: queryKeys.categories });
      if (!categoryId) {
        setCategoryId(saved.id);
        // Заведение остаётся в адресе: иначе «Назад» после сохранения уводит
        // из сервиса в общее меню отеля — не туда, откуда пришли.
        navigate(
          serviceId
            ? cmsPath(`/menu/categories/${saved.id}?service_id=${serviceId}`)
            : cmsPath(`/menu/categories/${saved.id}`),
          { replace: true },
        );
      }
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
  const back = parentOf(
    location.pathname,
    {
      service: serviceId
        ? { id: serviceId, name: knownServiceName ?? serviceQuery.data?.public_name }
        : null,
      language: languages.displayLanguage,
      fallbackLanguage: languages.defaultCode,
    },
    t,
  );

  if (bootstrapLoading || categoriesQuery.isLoading) {
    return (
      <PageContainer>
        <Skeleton variant="rounded" height={64} sx={{ mb: 2 }} />
        <Skeleton variant="rounded" height={360} />
      </PageContainer>
    );
  }

  if (!bootstrap) {
    return (
      <PageContainer>
        <Alert severity="error">{t('errors.loadBootstrap')}</Alert>
      </PageContainer>
    );
  }

  // Дерево разделов нужно и для выбора родителя, и для проверки имён.
  // Пустое вместо неотвеченного — это форма, которая соглашается на всё, а
  // потом отказывает при сохранении.
  if (categoriesQuery.isError || categoriesQuery.data === undefined) {
    return (
      <PageContainer>
        <QueryState query={categoriesQuery} what={t('state.what.category')}>
          {() => null}
        </QueryState>
      </PageContainer>
    );
  }

  return (
    <PageContainer sx={{ pb: 10 }}>
      {/* Шапка переносится, а не режет заголовок многоточием: на 390 «Новая
          категория» не помещалась рядом с «Назад» и «Сохранить» (партия 55). */}
      <Stack
        direction="row"
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        spacing={2}
        rowGap={1}
        sx={{ mb: 2 }}
      >
        {/* «← Меню «<заведение>»» по карте маршрутов (партия 56); было
            безличное «Назад» в `/cms/menu` — мимо адреса панели на хосте отеля. */}
        {back ? <BackLink to={back.to} label={back.label} testId="category-back-button" /> : null}
        <Stack sx={{ flex: '1 1 160px', minWidth: 0 }}>
          <Typography variant="h5" sx={{ overflowWrap: 'anywhere' }}>
            {isNew
              ? t('category.newTitle')
              : pickTranslated(form.title, languages.displayLanguage, languages.defaultCode) ||
                t('category.untitled')}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {isDirty ? t('editor.unsaved') : t('editor.saved')}
          </Typography>
        </Stack>
        {isDirty ? (
          <Chip size="small" color="warning" label={t('editor.unsavedBadge')} />
        ) : null}
        <Button
          variant="contained"
          disabled={!isValid || !isDirty || saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
          data-testid="category-save-button"
          startIcon={
            saveMutation.isPending ? <CircularProgress size={16} color="inherit" /> : undefined
          }
        >
          {t('common.save')}
        </Button>
      </Stack>

      {/* Две колонки — только там, где форме остаётся место (от lg). Уже —
          столбиком: форма сверху, изображение ниже. Ряд на 390 схлопывал
          форму в полоску, а колонка изображения в 380 ложилась поверх
          (партия 55). */}
      <Stack direction={{ xs: 'column', lg: 'row' }} spacing={3} alignItems={{ xs: 'stretch', lg: 'flex-start' }}>
        <Card variant="outlined" sx={{ flexGrow: 1, minWidth: 0, borderColor: 'divider' }}>
          <CardContent>
            <Stack spacing={2.5}>
              <TranslatedField
                label={t('category.title')}
                value={form.title}
                onChange={(title) => setForm((prev) => ({ ...prev, title }))}
                languages={languages.codes}
                languageLabels={languages.labels}
                defaultLanguage={languages.defaultCode}
                required
                error={fieldErrors.title}
                testId="category-title-input"
                activeLanguage={activeLanguage}
                onActiveLanguageChange={setActiveLanguage}
              />

              <TranslatedField
                label={t('category.description')}
                value={form.description}
                onChange={(description) => setForm((prev) => ({ ...prev, description }))}
                languages={languages.codes}
                languageLabels={languages.labels}
                defaultLanguage={languages.defaultCode}
                multiline
                rows={3}
                testId="category-description-input"
                activeLanguage={activeLanguage}
                onActiveLanguageChange={setActiveLanguage}
              />

              {/* Общая сетка формы: края полей одной колонки совпадают, на узком
                  экране всё во всю ширину (партия 55). */}
              <FormGrid>
                <FormCell span={6}>
                  {/* Отступ глубины пробелами в списке схлопывался, а в поле мешал
                      бы — вложенность видна по родителю второй строкой. */}
                  <SelectField
                    size="small"
                    label={t('category.parent')}
                    value={form.parent_id ?? ROOT}
                    onChange={(next) =>
                      setForm((prev) => ({
                        ...prev,
                        parent_id: next === ROOT || next === '' ? null : next,
                      }))
                    }
                    testId="category-parent-select"
                    options={[
                      { value: ROOT, label: t('category.noParent') },
                      ...categoryOptions(
                        flattenCategories(tree),
                        (category) =>
                          pickTranslated(
                            category.title,
                            languages.displayLanguage,
                            languages.defaultCode,
                          ) || category.code,
                      ).filter((option) => !forbiddenParents.has(option.value)),
                    ]}
                  />
                </FormCell>

                <FormCell span={3}>
                  <TextField
                    size="small"
                    type="number"
                    fullWidth
                    label={t('category.sortOrder')}
                    value={form.sort_order}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, sort_order: Number(event.target.value) }))
                    }
                    inputProps={{ 'data-testid': 'category-sort-input' }}
                  />
                </FormCell>

                <FormCell span={3}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={form.is_active}
                        onChange={(event) =>
                          setForm((prev) => ({ ...prev, is_active: event.target.checked }))
                        }
                        inputProps={
                          { 'data-testid': 'category-active-switch' } as Record<string, string>
                        }
                      />
                    }
                    label={t('category.active')}
                    sx={{ minHeight: 40 }}
                  />
                </FormCell>
              </FormGrid>

              <Box>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                  {t('schedule.section')}
                </Typography>
                <SchedulePicker
                  value={form.schedule_id}
                  onChange={(schedule_id) => setForm((prev) => ({ ...prev, schedule_id }))}
                  schedules={bootstrap.schedules}
                  dayParts={bootstrap.day_parts}
                  testId="category-schedule-select"
                />
              </Box>

              <Box>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                  {t('category.commerceSection')}
                </Typography>
                <FormGrid>
                  <FormCell span={6}>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={form.service_fee_applies}
                          onChange={(event) =>
                            setForm((prev) => ({ ...prev, service_fee_applies: event.target.checked }))
                          }
                          inputProps={
                            { 'data-testid': 'cms-category-service-fee' } as Record<string, string>
                          }
                        />
                      }
                      label={t('category.serviceFeeApplies')}
                      sx={{ minHeight: 40 }}
                    />
                  </FormCell>
                  <FormCell span={6}>
                    <TextField
                      size="small"
                      label={t('category.minOrder')}
                      value={form.minOrderInput}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, minOrderInput: event.target.value }))
                      }
                      error={Boolean(fieldErrors.min_order_minor)}
                      helperText={fieldErrors.min_order_minor ?? t('category.minOrderHint')}
                      fullWidth
                      InputProps={{
                        endAdornment: (
                          <InputAdornment position="end">
                            {currencySymbol(bootstrap.hotel.currency, languages.displayLanguage)}
                          </InputAdornment>
                        ),
                      }}
                      inputProps={{ 'data-testid': 'cms-category-min-order', inputMode: 'decimal' }}
                    />
                  </FormCell>
                </FormGrid>
              </Box>
            </Stack>
          </CardContent>
        </Card>

        <Card variant="outlined" sx={{ width: { xs: 'auto', lg: 380 }, flexShrink: 0, borderColor: 'divider' }}>
          <CardContent>
            <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
              {t('category.image')}
            </Typography>
            <ImageUploader
              surface="categoryCover"
              value={image}
              onChange={setImage}
              kind="category"
              multiple={false}
              testId="category-image-uploader"
            />
          </CardContent>
        </Card>
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
    </PageContainer>
  );
}
