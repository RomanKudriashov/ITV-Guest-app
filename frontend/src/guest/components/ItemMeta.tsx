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

  // NO КБЖУ table — the values read as a
  // single line under the description, each number in the display face.
  const macros: { label: string; value: number }[] = [];
  if (nutrition.calories != null)
    macros.push({ label: t('guest.item.kcal'), value: nutrition.calories });
  if (nutrition.protein != null)
    macros.push({ label: t('guest.item.protein'), value: nutrition.protein });
  if (nutrition.fat != null)
    macros.push({ label: t('guest.item.fat'), value: nutrition.fat });
  if (nutrition.carbs != null)
    macros.push({ label: t('guest.item.carbs'), value: nutrition.carbs });

  const composition = nutrition.composition?.trim();
  if (!macros.length && !composition) return null;

  return (
    <Stack spacing={1.25} data-testid="guest-item-nutrition">
      {macros.length ? (
        <Stack
          direction="row"
          flexWrap="wrap"
          useFlexGap
          sx={{ columnGap: 1.75, rowGap: 0.5, color: 'text.secondary', fontSize: '0.78rem' }}
        >
          {macros.map((macro) => (
            <Box component="span" key={macro.label}>
              <Box
                component="b"
                sx={(theme) => ({
                  color: 'text.primary',
                  fontFamily: theme.typography.h1.fontFamily,
                  fontWeight: theme.typography.fontWeightBold,
                  fontSize: '0.875rem',
                  fontVariantNumeric: 'tabular-nums',
                  mr: 0.5,
                })}
              >
                {macro.value}
              </Box>
              {macro.label}
            </Box>
          ))}
        </Stack>
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
 * Compact one-line КБЖУ for a catalog card (reference `.nutri`): the calorie
 * value reads in the display face, the macros follow as a muted, dot-separated
 * run. Rendered only from the data the item actually carries. Units stay numeric
 * (ккал / г) so the single line is correct in every language, not just RU.
 */
export function NutritionInline({ nutrition }: { nutrition?: ItemDetail['nutrition'] }) {
  const { t } = useTranslation();
  if (!nutrition) return null;
  const { calories, protein, fat, carbs } = nutrition;
  const macros = [protein, fat, carbs].filter((v): v is number => v != null);
  if (calories == null && !macros.length) return null;

  return (
    <Typography
      component="div"
      variant="caption"
      color="text.secondary"
      data-testid="guest-item-nutrition-inline"
      sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, flexWrap: 'wrap' }}
    >
      {calories != null ? (
        <Box component="span">
          <Box
            component="b"
            sx={(theme) => ({
              color: 'text.secondary',
              fontFamily: theme.typography.h1.fontFamily,
              fontWeight: theme.typography.fontWeightBold,
              fontVariantNumeric: 'tabular-nums',
              mr: 0.375,
            })}
          >
            {calories}
          </Box>
          {t('guest.item.kcal')}
        </Box>
      ) : null}
      {calories != null && macros.length ? <Box component="span">·</Box> : null}
      {macros.length ? (
        <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {macros.join(' · ')} {t('guest.item.gram')}
        </Box>
      ) : null}
    </Typography>
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
