import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

import { ApiError } from '@/api/client';
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
import { TranslatedField } from '@/components/TranslatedField';
import { useToast } from '@/components/ToastProvider';
import { useBootstrap, useContentLanguages } from '@/hooks/useBootstrap';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { findCategory, flattenCategories, subtreeIds } from '@/utils/categories';
import { compactTranslated, pickTranslated } from '@/utils/translated';

interface CategoryForm {
  title: Translated;
  description: Translated;
  parent_id: string | null;
  sort_order: number;
  is_active: boolean;
  schedule_id: string | null;
}

const EMPTY_FORM: CategoryForm = {
  title: {},
  description: {},
  parent_id: null,
  sort_order: 0,
  is_active: true,
  schedule_id: null,
};

const ROOT = '__root__';

export function CategoryEditorPage() {
  const { t } = useTranslation();
  const { id: routeId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [categoryId, setCategoryId] = useState<string | null>(
    routeId && routeId !== 'new' ? routeId : null,
  );
  const isNew = !categoryId;

  const { data: bootstrap, isLoading: bootstrapLoading } = useBootstrap();
  const languages = useContentLanguages(bootstrap);

  const categoriesQuery = useQuery({
    queryKey: queryKeys.categories,
    queryFn: fetchCategories,
  });
  const tree = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  const current = categoryId ? findCategory(tree, categoryId) : null;

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
    return { ...errors, ...serverErrors };
  }, [form.title, languages, serverErrors, t]);

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
      };
      return categoryId ? updateCategory(categoryId, payload) : createCategory(payload);
    },
    onSuccess: async (saved: Category) => {
      setServerErrors({});
      toast.show(t('category.saved'), 'success');
      await queryClient.invalidateQueries({ queryKey: queryKeys.categories });
      if (!categoryId) {
        setCategoryId(saved.id);
        navigate(`/cms/menu/categories/${saved.id}`, { replace: true });
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

  if (bootstrapLoading || categoriesQuery.isLoading) {
    return (
      <Box sx={{ p: 3 }}>
        <Skeleton variant="rounded" height={64} sx={{ mb: 2 }} />
        <Skeleton variant="rounded" height={360} />
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

  return (
    <Box sx={{ p: 3, pb: 10 }}>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/cms/menu')}
          data-testid="category-back-button"
        >
          {t('common.back')}
        </Button>
        <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="h5" noWrap>
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

      <Stack direction="row" spacing={3} alignItems="flex-start">
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

              <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
                <TextField
                  select
                  size="small"
                  label={t('category.parent')}
                  value={form.parent_id ?? ROOT}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      parent_id: event.target.value === ROOT ? null : event.target.value,
                    }))
                  }
                  sx={{ minWidth: 260 }}
                  inputProps={{ 'data-testid': 'category-parent-select' }}
                >
                  <MenuItem value={ROOT}>{t('category.noParent')}</MenuItem>
                  {flattenCategories(tree)
                    .filter(({ category }) => !forbiddenParents.has(category.id))
                    .map(({ category, depth }) => (
                      <MenuItem key={category.id} value={category.id}>
                        {`${' '.repeat(depth * 3)}${
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
                  type="number"
                  label={t('category.sortOrder')}
                  value={form.sort_order}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, sort_order: Number(event.target.value) }))
                  }
                  sx={{ width: 160 }}
                  inputProps={{ 'data-testid': 'category-sort-input' }}
                />

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
                />
              </Stack>

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
            </Stack>
          </CardContent>
        </Card>

        <Card variant="outlined" sx={{ width: 380, flexShrink: 0, borderColor: 'divider' }}>
          <CardContent>
            <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
              {t('category.image')}
            </Typography>
            <ImageUploader
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
    </Box>
  );
}
