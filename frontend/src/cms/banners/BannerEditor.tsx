import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { useTranslation } from 'react-i18next';

import {
  addBannerImage,
  createBanner,
  removeBannerImage,
  updateBanner,
  uploadMedia,
  type Banner,
} from '@/api/cms';
import { fetchRoomCategories } from '@/api/hotelAdmin';
import { MultiSelectField, SelectField } from '@/components/SelectField';
import { fetchServices } from '@/cms/services/api';
import { useBootstrap, useContentLanguages } from '@/hooks/useBootstrap';
import { DateField, TimeField } from '@/components/DateField';
import { refImgProps } from '@/media/refImg';

/**
 * Форма баннера: что показать, куда вести и кому показывать.
 *
 * Правила показа собраны в один блок намеренно: они действуют СОВМЕСТНО (даты
 * И время И язык И категория), и разложенные по вкладкам создавали бы
 * впечатление независимых переключателей.
 */
interface Props {
  banner: Banner | null;
  onClose: () => void;
  onSaved: () => void;
}

const EMPTY: Partial<Banner> = {
  name: '',
  size: 'm',
  placement: 'top',
  action: 'none',
  is_active: true,
  first_visit_only: false,
  priority: 0,
  languages: [],
  room_category_ids: [],
};

export function BannerEditor({ banner, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const { data: bootstrap } = useBootstrap();
  const languages = useContentLanguages(bootstrap);
  const [draft, setDraft] = useState<Partial<Banner>>(banner ?? EMPTY);
  const [images, setImages] = useState(banner?.images ?? []);
  const [error, setError] = useState<string | null>(null);

  const categories = useQuery({ queryKey: ['cms', 'rooms', 'categories'], queryFn: fetchRoomCategories });
  const services = useQuery({ queryKey: ['cms', 'services', 'for-banner'], queryFn: () => fetchServices() });

  const set = (patch: Partial<Banner>) => setDraft((current) => ({ ...current, ...patch }));
  const text = (field: 'title' | 'subtitle' | 'page_title' | 'page_body', code: string) =>
    ((draft[field] as Record<string, string> | undefined) ?? {})[code] ?? '';
  const setText = (field: 'title' | 'subtitle' | 'page_title' | 'page_body', code: string, value: string) =>
    set({ [field]: { ...((draft[field] as Record<string, string>) ?? {}), [code]: value } } as Partial<Banner>);

  const save = useMutation({
    mutationFn: async () => {
      const payload = { ...draft };
      return banner ? updateBanner(banner.id, payload) : createBanner(payload);
    },
    onSuccess: onSaved,
    onError: (cause) => setError(cause instanceof Error ? cause.message : t('banners.saveFailed')),
  });

  const attach = useMutation({
    mutationFn: async (file: File) => {
      if (!banner) throw new Error(t('banners.saveFirst'));
      const asset = await uploadMedia(file, 'banner');
      return addBannerImage(banner.id, asset.id);
    },
    onSuccess: (fresh) => setImages(fresh.images),
    onError: (cause) => setError(cause instanceof Error ? cause.message : t('banners.saveFailed')),
  });

  const detach = useMutation({
    mutationFn: (imageId: string) => removeBannerImage(banner!.id, imageId),
    onSuccess: (fresh) => setImages(fresh.images),
  });

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose}>
      <DialogTitle>{banner ? t('banners.edit') : t('banners.add')}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ pt: 1 }} data-testid="cms-banner-form">
          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            label={t('banners.name')}
            value={draft.name ?? ''}
            onChange={(event) => set({ name: event.target.value })}
            size="small"
            helperText={t('banners.nameHint')}
            inputProps={{ 'data-testid': 'cms-banner-name' }}
          />

          {languages.codes.map((code) => (
            <Stack key={code} direction="row" spacing={1}>
              <TextField
                label={`${t('banners.bannerTitle')} · ${code}`}
                value={text('title', code)}
                onChange={(event) => setText('title', code, event.target.value)}
                size="small"
                fullWidth
              />
              <TextField
                label={`${t('banners.bannerSubtitle')} · ${code}`}
                value={text('subtitle', code)}
                onChange={(event) => setText('subtitle', code, event.target.value)}
                size="small"
                fullWidth
              />
            </Stack>
          ))}

          <Stack direction="row" spacing={1}>
            <SelectField<Banner['size']>
              size="small"
              label={t('banners.sizeLabel')}
              value={draft.size ?? 'm'}
              onChange={(next) => set({ size: next })}
              testId="cms-banner-size"
              options={(['s', 'm', 'l'] as const).map((value) => ({ value, label: t(`banners.size.${value}`) }))}
            />
            <SelectField<Banner['placement']>
              size="small"
              label={t('banners.placeLabel')}
              value={draft.placement ?? 'top'}
              onChange={(next) => set({ placement: next })}
              testId="cms-banner-placement"
              options={(['top', 'bottom'] as const).map((value) => ({ value, label: t(`banners.place.${value}`) }))}
            />
            <TextField
              size="small" type="number" fullWidth
              label={t('banners.priority')}
              value={draft.priority ?? 0}
              onChange={(event) => set({ priority: Number(event.target.value) })}
              helperText={t('banners.priorityHint')}
            />
          </Stack>

          <Divider textAlign="left">
            <Typography variant="caption">{t('banners.pictures')}</Typography>
          </Divider>
          {!banner ? (
            <Alert severity="info">{t('banners.saveFirst')}</Alert>
          ) : (
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {images.map((image) => (
                <Box key={image.id} sx={{ position: 'relative' }}>
                  <Box
                    component="img"
                    // Кадр баннера объектом картинки (партия 58а); место 120×72.
                    {...refImgProps(image, '120px')}
                    alt=""
                    sx={{ width: 120, height: 72, objectFit: 'cover', borderRadius: 1 }}
                  />
                  <IconButton
                    size="small"
                    onClick={() => detach.mutate(image.id)}
                    sx={{ position: 'absolute', top: 0, insetInlineEnd: 0, bgcolor: 'background.paper' }}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Box>
              ))}
              <Button component="label" variant="outlined" size="small" data-testid="cms-banner-upload">
                {t('banners.addPicture')}
                <input
                  hidden
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) attach.mutate(file);
                  }}
                />
              </Button>
            </Stack>
          )}

          <Divider textAlign="left">
            <Typography variant="caption">{t('banners.actionLabel')}</Typography>
          </Divider>
          <SelectField<Banner['action']>
            size="small"
            label={t('banners.actionLabel')}
            value={draft.action ?? 'none'}
            onChange={(next) => set({ action: next })}
            testId="cms-banner-action"
            options={(['none', 'link', 'venue', 'page'] as const).map((value) => ({
              value,
              label: t(`banners.action.${value}`),
            }))}
          />
          {draft.action === 'link' && (
            <TextField
              size="small"
              label={t('banners.url')}
              value={draft.action_url ?? ''}
              onChange={(event) => set({ action_url: event.target.value })}
              inputProps={{ 'data-testid': 'cms-banner-url' }}
            />
          )}
          {draft.action === 'venue' && (
            <SelectField
              size="small"
              label={t('banners.venue')}
              value={draft.action_service_id ?? ''}
              onChange={(next) => set({ action_service_id: next })}
              loading={services.isLoading}
              options={(services.data ?? []).map((service) => ({
                value: service.id,
                label: service.public_name?.[languages.displayLanguage] ?? service.code,
              }))}
            />
          )}
          {draft.action === 'page' && (
            <Stack spacing={1}>
              {languages.codes.map((code) => (
                <Stack key={code} spacing={1}>
                  <TextField
                    size="small"
                    label={`${t('banners.pageTitle')} · ${code}`}
                    value={text('page_title', code)}
                    onChange={(event) => setText('page_title', code, event.target.value)}
                  />
                  <TextField
                    size="small" multiline minRows={3}
                    label={`${t('banners.pageBody')} · ${code}`}
                    value={text('page_body', code)}
                    onChange={(event) => setText('page_body', code, event.target.value)}
                  />
                </Stack>
              ))}
            </Stack>
          )}

          <Divider textAlign="left">
            <Typography variant="caption">{t('banners.rules')}</Typography>
          </Divider>
          <Typography variant="caption" color="text.secondary">
            {t('banners.rulesHint')}
          </Typography>
          <Stack direction="row" spacing={1}>
            {/* Даты и время — общим полем, не системным (партия 55). */}
            <DateField
              size="small" fullWidth
              label={t('banners.from')}
              value={draft.starts_on ?? ''}
              onChange={(next) => set({ starts_on: next || null })}
            />
            <DateField
              size="small" fullWidth
              label={t('banners.to')}
              value={draft.ends_on ?? ''}
              onChange={(next) => set({ ends_on: next || null })}
            />
          </Stack>
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <TimeField
              size="small" fullWidth
              label={t('banners.timeFrom')}
              value={draft.time_from ?? ''}
              onChange={(next) => set({ time_from: next || null })}
            />
            <TimeField
              size="small" fullWidth
              label={t('banners.timeTo')}
              value={draft.time_to ?? ''}
              onChange={(next) => set({ time_to: next || null })}
              helperText={t('banners.timeHint')}
            />
          </Stack>
          <FormControlLabel
            control={
              <Checkbox
                checked={draft.first_visit_only ?? false}
                onChange={(event) => set({ first_visit_only: event.target.checked })}
                data-testid="cms-banner-first-visit"
              />
            }
            label={t('banners.firstVisit')}
          />
          <MultiSelectField
            size="small"
            label={t('banners.languages')}
            value={draft.languages ?? []}
            onChange={(next) => set({ languages: next })}
            helperText={t('banners.languagesHint')}
            options={languages.codes.map((code) => ({ value: code, label: code }))}
          />
          <MultiSelectField
            size="small"
            label={t('banners.categories')}
            value={draft.room_category_ids ?? []}
            onChange={(next) => set({ room_category_ids: next })}
            helperText={t('banners.categoriesHint')}
            testId="cms-banner-categories"
            loading={categories.isLoading}
            options={(categories.data ?? []).map((category) => ({
              value: category.id,
              label: category.title_i18n || category.code,
            }))}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={draft.is_active ?? true}
                onChange={(event) => set({ is_active: event.target.checked })}
                data-testid="cms-banner-active"
              />
            }
            label={t('banners.active')}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          onClick={() => save.mutate()}
          disabled={save.isPending || !draft.name}
          data-testid="cms-banner-save"
        >
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
