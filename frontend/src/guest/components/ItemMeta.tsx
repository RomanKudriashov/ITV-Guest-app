import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { KitImage } from '@/kit';
import type { AppIconComponent } from '@/icons';
import type { ItemDetail } from '../api/types';

/** Dietary / kitchen flags. Unknown codes fall back to the raw code. */
export function FlagChips({ flags, size = 'small' }: { flags: string[]; size?: 'small' | 'medium' }) {
  const { t } = useTranslation();
  if (!flags?.length) return null;
  return (
    <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
      {flags.map((flag) => (
        <Chip
          key={flag}
          size={size}
          variant="outlined"
          label={t(`guest.flags.${flag}`, { defaultValue: flag })}
          sx={{ height: 22, fontSize: '0.7rem' }}
        />
      ))}
    </Stack>
  );
}

export function AllergenLine({ allergens }: { allergens: string[] }) {
  const { t } = useTranslation();
  if (!allergens?.length) return null;
  const list = allergens
    .map((code) => t(`guest.allergens.${code}`, { defaultValue: code }))
    .join(', ');
  return (
    <Typography variant="body2" color="text.secondary">
      {t('guest.item.allergens')}: {list}
    </Typography>
  );
}

/**
 * КБЖУ + состав. Rendered ENTIRELY from the presence of data — a card shows the
 * calories/macros row only when the item carries them, and the состав line only
 * when it is filled in. It never branches on the offering type: a service or a
 * booking with a `nutrition` block would render the very same way.
 */
export function NutritionBlock({ nutrition }: { nutrition?: ItemDetail['nutrition'] }) {
  const { t } = useTranslation();
  if (!nutrition) return null;

  const g = t('guest.item.gram');
  const macros: { label: string; value: string }[] = [];
  if (nutrition.calories != null)
    macros.push({ label: t('guest.item.calories'), value: `${nutrition.calories} ${t('guest.item.kcal')}` });
  if (nutrition.protein != null)
    macros.push({ label: t('guest.item.protein'), value: `${nutrition.protein} ${g}` });
  if (nutrition.fat != null)
    macros.push({ label: t('guest.item.fat'), value: `${nutrition.fat} ${g}` });
  if (nutrition.carbs != null)
    macros.push({ label: t('guest.item.carbs'), value: `${nutrition.carbs} ${g}` });

  const composition = nutrition.composition?.trim();
  if (!macros.length && !composition) return null;

  return (
    <Stack spacing={1.25} data-testid="guest-item-nutrition">
      {macros.length ? (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: `repeat(${macros.length}, minmax(0, 1fr))`,
            gap: 1,
          }}
        >
          {macros.map((macro) => (
            <Stack
              key={macro.label}
              spacing={0.25}
              sx={(theme) => ({
                px: 1,
                py: 1,
                borderRadius: `${theme.palette.brand.radius.md}px`,
                bgcolor: theme.palette.brand.surfaceMuted,
                textAlign: 'center',
              })}
            >
              <Typography
                variant="subtitle2"
                sx={(theme) => ({
                  fontFamily: theme.typography.h1.fontFamily,
                  fontVariantNumeric: 'tabular-nums',
                })}
              >
                {macro.value}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {macro.label}
              </Typography>
            </Stack>
          ))}
        </Box>
      ) : null}
      {composition ? (
        <Typography variant="body2" color="text.secondary">
          <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>
            {t('guest.item.composition')}:{' '}
          </Box>
          {composition}
        </Typography>
      ) : null}
    </Stack>
  );
}

/**
 * Square thumbnail — a lazy image with a skeleton, or a DESIGNED fallback (a
 * monochrome icon on a textured token surface) when the item has no photo. Never
 * a flat coloured circle.
 */
export function ItemThumb({
  src,
  alt,
  size = 72,
  dimmed = false,
  fallbackIcon,
}: {
  src?: string | null;
  alt: string;
  size?: number;
  dimmed?: boolean;
  fallbackIcon?: AppIconComponent;
}) {
  return (
    <Box
      sx={{
        position: 'relative',
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: 2,
        overflow: 'hidden',
        opacity: dimmed ? 0.5 : 1,
      }}
    >
      <KitImage src={src} alt={alt} fill fallbackIcon={fallbackIcon} fallbackIconSize={Math.round(size * 0.4)} />
    </Box>
  );
}
