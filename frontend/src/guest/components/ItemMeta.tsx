import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { KitImage } from '@/kit';
import type { AppIconComponent } from '@/icons';
import type { ItemCharacteristic, ItemDetail, ItemFacet } from '../api/types';

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

/**
 * Allergens («contains» — amber pills) and dietary markers («suitable» — green
 * pills), reference desktop §3. Localized titles come from the payload. Renders
 * nothing when the item carries neither — no empty «Аллергены» block.
 */
/** Dietary markers as green chips — the catalog card keeps these (allergens do not). */
export function MarkerChips({ markers, size = 'small' }: { markers?: ItemFacet[]; size?: 'small' | 'medium' }) {
  if (!markers?.length) return null;
  return (
    <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
      {markers.map((marker) => (
        <Chip
          key={marker.code}
          size={size}
          variant="outlined"
          label={marker.title}
          data-testid={`guest-marker-${marker.code}`}
          sx={(theme) => ({
            height: 22,
            fontSize: '0.7rem',
            color: theme.palette.success.main,
            borderColor: `color-mix(in srgb, ${theme.palette.success.main} 42%, transparent)`,
          })}
        />
      ))}
    </Stack>
  );
}

export function AllergensBlock({
  allergens,
  markers,
}: {
  allergens?: ItemFacet[];
  markers?: ItemFacet[];
}) {
  const { t } = useTranslation();
  const hasAllergens = Boolean(allergens?.length);
  const hasMarkers = Boolean(markers?.length);
  if (!hasAllergens && !hasMarkers) return null;

  return (
    <Box data-testid="guest-item-allergens">
      <Typography
        sx={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.04em', color: 'text.secondary', mb: 0.75 }}
      >
        {t('guest.item.allergens')}
      </Typography>
      <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
        {allergens?.map((a) => (
          <FacetPill key={`a-${a.code}`} label={a.title} tone="contains" />
        ))}
        {markers?.map((m) => (
          <FacetPill key={`m-${m.code}`} label={m.title} tone="suitable" />
        ))}
      </Stack>
    </Box>
  );
}

function FacetPill({ label, tone }: { label: string; tone: 'contains' | 'suitable' }) {
  return (
    <Box
      component="span"
      sx={(theme) => {
        const base = tone === 'contains' ? theme.palette.warning.main : theme.palette.success.main;
        return {
          display: 'inline-flex',
          alignItems: 'center',
          px: 1,
          py: 0.35,
          borderRadius: `${theme.palette.brand.radius.sm}px`,
          fontSize: '0.72rem',
          fontWeight: 600,
          lineHeight: 1.4,
          color: base,
          bgcolor: `color-mix(in srgb, ${base} 14%, transparent)`,
          border: `1px solid color-mix(in srgb, ${base} 38%, transparent)`,
        };
      }}
    >
      {label}
    </Box>
  );
}

/** Ordered «name → value» characteristics (desktop §3). Empty → nothing. */
export function CharacteristicsBlock({ characteristics }: { characteristics?: ItemCharacteristic[] }) {
  if (!characteristics?.length) return null;
  return (
    <Stack spacing={0.5} data-testid="guest-item-characteristics">
      {characteristics.map((row, i) => (
        <Stack key={i} direction="row" spacing={1} sx={{ fontSize: '0.82rem' }}>
          <Box component="span" sx={{ color: 'text.secondary', minWidth: 130 }}>
            {row.name}
          </Box>
          <Box component="span" sx={{ color: 'text.primary', fontWeight: 500 }}>
            {row.value}
          </Box>
        </Stack>
      ))}
    </Stack>
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
  const macros: { label: string; value: number; lead?: string }[] = [];
  if (nutrition.calories != null)
    macros.push({ label: t('guest.item.kcal'), value: nutrition.calories });
  if (nutrition.protein != null)
    macros.push({ label: t('guest.item.protein'), value: nutrition.protein });
  if (nutrition.fat != null)
    macros.push({ label: t('guest.item.fat'), value: nutrition.fat });
  if (nutrition.carbs != null)
    macros.push({ label: t('guest.item.carbs'), value: nutrition.carbs });
  if (nutrition.portion != null)
    macros.push({ label: t('guest.item.gram'), value: nutrition.portion, lead: t('guest.item.portion') });

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
              {macro.lead ? <Box component="span" sx={{ mr: 0.5 }}>{macro.lead}</Box> : null}
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
  const { calories, protein, fat, carbs, portion } = nutrition;
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
      {portion != null ? (
        <>
          <Box component="span">·</Box>
          <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {t('guest.item.portion')} {portion} {t('guest.item.gram')}
          </Box>
        </>
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
