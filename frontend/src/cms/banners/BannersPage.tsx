import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { QueryState } from '@/components/QueryState';
import { deleteBanner, fetchBanners, type Banner } from '@/api/cms';
import { BannerEditor } from './BannerEditor';

/**
 * Рекламные баннеры витрины и их цифры.
 *
 * ПОЧЕМУ СТАТИСТИКА ЗДЕСЬ, А НЕ В АНАЛИТИКЕ. Аналитика отвечает на два
 * вопроса: что продано и как работает смена. Баннер не продаёт — связи
 * «баннер → заказ» мы не измеряем и выдумывать не станем, — а рядом с выручкой
 * его числа читались бы как канал продаж. Цифры нужны, чтобы поправить ПРАВИЛО
 * показа, и потому живут на той же карточке, что и правило.
 *
 * CTR = переходы ÷ показы, а не клики ÷ показы: показ считается один раз на
 * сессию, и делить на него общее число нажатий значило бы делить разные
 * единицы. Гость, нажавший трижды, — один заинтересовавшийся.
 */
export function BannersPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Banner | 'new' | null>(null);

  const banners = useQuery({ queryKey: ['cms', 'banners'], queryFn: fetchBanners });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['cms', 'banners'] });

  const remove = useMutation({
    mutationFn: (id: string) => deleteBanner(id),
    onSuccess: invalidate,
  });

  return (
    <Box data-testid="cms-banners">
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Stack>
          <Typography variant="h6">{t('banners.title')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('banners.subtitle')}
          </Typography>
        </Stack>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setEditing('new')}
          data-testid="cms-banner-add"
        >
          {t('banners.add')}
        </Button>
      </Stack>

      <QueryState query={banners} what={t('banners.what')}>
        {(rows) =>
          rows.length === 0 ? (
            <Alert severity="info" data-testid="cms-banners-empty">
              {t('banners.empty')}
            </Alert>
          ) : (
            <Stack spacing={1.5}>
              {rows.map((banner) => (
                <Card key={banner.id} variant="outlined" data-testid={`cms-banner-${banner.id}`}>
                  <CardContent>
                    <Stack direction="row" spacing={2} alignItems="flex-start">
                      {banner.images[0] && (
                        <Box
                          component="img"
                          src={banner.images[0].url}
                          alt=""
                          sx={{ width: 120, height: 72, objectFit: 'cover', borderRadius: 1 }}
                        />
                      )}
                      <Stack sx={{ flex: 1 }} spacing={0.5}>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography variant="subtitle1">{banner.name}</Typography>
                          {!banner.is_active && (
                            <Chip size="small" label={t('banners.off')} />
                          )}
                          <Chip size="small" variant="outlined" label={t(`banners.place.${banner.placement}`)} />
                          <Chip size="small" variant="outlined" label={t(`banners.size.${banner.size}`)} />
                          <Chip size="small" variant="outlined" label={t('banners.priorityShort', { value: banner.priority })} />
                        </Stack>
                        <Typography variant="body2" color="text.secondary">
                          {rulesLine(banner, t)}
                        </Typography>
                        {/* Четыре числа рядом с правилом, которое их породило. */}
                        <Typography variant="body2" data-testid={`cms-banner-stats-${banner.id}`}>
                          {t('banners.stats', {
                            impressions: banner.stats.impressions,
                            clicks: banner.stats.clicks,
                            reached: banner.stats.reached,
                            ctr: (banner.stats.ctr * 100).toFixed(1),
                          })}
                        </Typography>
                      </Stack>
                      <Stack direction="row">
                        <IconButton
                          onClick={() => setEditing(banner)}
                          data-testid={`cms-banner-edit-${banner.id}`}
                        >
                          <EditOutlinedIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          onClick={() => remove.mutate(banner.id)}
                          data-testid={`cms-banner-delete-${banner.id}`}
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    </Stack>
                  </CardContent>
                </Card>
              ))}
            </Stack>
          )
        }
      </QueryState>

      {editing && (
        <BannerEditor
          banner={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void invalidate();
          }}
        />
      )}
    </Box>
  );
}

/** Правила показа одной строкой: оператор не должен открывать форму, чтобы их узнать. */
function rulesLine(banner: Banner, t: TFunction): string {
  const parts: string[] = [];
  if (banner.starts_on || banner.ends_on) {
    parts.push(`${banner.starts_on ?? '…'} — ${banner.ends_on ?? '…'}`);
  }
  if (banner.time_from || banner.time_to) {
    parts.push(`${banner.time_from ?? '00:00'}–${banner.time_to ?? '23:59'}`);
  }
  if (banner.first_visit_only) parts.push(t('banners.firstVisitShort'));
  if (banner.languages.length) parts.push(banner.languages.join(', '));
  if (banner.room_category_ids.length) {
    parts.push(t('banners.categoriesShort', { count: banner.room_category_ids.length }));
  }
  return parts.length ? parts.join(' · ') : t('banners.noRules');
}
