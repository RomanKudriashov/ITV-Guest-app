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
import MenuItem from '@mui/material/MenuItem';
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
import { fetchServices } from '@/cms/services/api';
import { useBootstrap, useContentLanguages } from '@/hooks/useBootstrap';

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
            <TextField
              select size="small" fullWidth
              label={t('banners.sizeLabel')}
              value={draft.size ?? 'm'}
              onChange={(event) => set({ size: event.target.value as Banner['size'] })}
              inputProps={{ 'data-testid': 'cms-banner-size' }}
            >
              {(['s', 'm', 'l'] as const).map((value) => (
                <MenuItem key={value} value={value}>{t(`banners.size.${value}`)}</MenuItem>
              ))}
            </TextField>
            <TextField
              select size="small" fullWidth
              label={t('banners.placeLabel')}
              value={draft.placement ?? 'top'}
              onChange={(event) => set({ placement: event.target.value as Banner['placement'] })}
              inputProps={{ 'data-testid': 'cms-banner-placement' }}
            >
              {(['top', 'bottom'] as const).map((value) => (
                <MenuItem key={value} value={value}>{t(`banners.place.${value}`)}</MenuItem>
              ))}
            </TextField>
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
                    src={image.url}
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
          <TextField
            select size="small"
            label={t('banners.actionLabel')}
            value={draft.action ?? 'none'}
            onChange={(event) => set({ action: event.target.value as Banner['action'] })}
            inputProps={{ 'data-testid': 'cms-banner-action' }}
          >
            {(['none', 'link', 'venue', 'page'] as const).map((value) => (
              <MenuItem key={value} value={value}>{t(`banners.action.${value}`)}</MenuItem>
            ))}
          </TextField>
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
            <TextField
              select size="small"
              label={t('banners.venue')}
              value={draft.action_service_id ?? ''}
              onChange={(event) => set({ action_service_id: event.target.value })}
            >
              {(services.data ?? []).map((service) => (
                <MenuItem key={service.id} value={service.id}>
                  {service.public_name?.[languages.displayLanguage] ?? service.code}
                </MenuItem>
              ))}
            </TextField>
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
            <TextField
              size="small" type="date" fullWidth InputLabelProps={{ shrink: true }}
              label={t('banners.from')}
              value={draft.starts_on ?? ''}
              onChange={(event) => set({ starts_on: event.target.value || null })}
            />
            <TextField
              size="small" type="date" fullWidth InputLabelProps={{ shrink: true }}
              label={t('banners.to')}
              value={draft.ends_on ?? ''}
              onChange={(event) => set({ ends_on: event.target.value || null })}
            />
          </Stack>
          <Stack direction="row" spacing={1}>
            <TextField
              size="small" type="time" fullWidth InputLabelProps={{ shrink: true }}
              label={t('banners.timeFrom')}
              value={draft.time_from ?? ''}
              onChange={(event) => set({ time_from: event.target.value || null })}
            />
            <TextField
              size="small" type="time" fullWidth InputLabelProps={{ shrink: true }}
              label={t('banners.timeTo')}
              value={draft.time_to ?? ''}
              onChange={(event) => set({ time_to: event.target.value || null })}
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
          <TextField
            select size="small" SelectProps={{ multiple: true }}
            label={t('banners.languages')}
            value={draft.languages ?? []}
            onChange={(event) =>
              set({ languages: event.target.value as unknown as string[] })
            }
            helperText={t('banners.languagesHint')}
          >
            {languages.codes.map((code) => (
              <MenuItem key={code} value={code}>{code}</MenuItem>
            ))}
          </TextField>
          <TextField
            select size="small" SelectProps={{ multiple: true }}
            label={t('banners.categories')}
            value={draft.room_category_ids ?? []}
            onChange={(event) =>
              set({ room_category_ids: event.target.value as unknown as string[] })
            }
            helperText={t('banners.categoriesHint')}
            inputProps={{ 'data-testid': 'cms-banner-categories' }}
          >
            {(categories.data ?? []).map((category) => (
              <MenuItem key={category.id} value={category.id}>
                {category.title_i18n || category.code}
              </MenuItem>
            ))}
          </TextField>
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
