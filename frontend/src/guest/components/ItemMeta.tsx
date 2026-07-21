import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import RestaurantMenuIcon from '@mui/icons-material/RestaurantMenu';
import { useTranslation } from 'react-i18next';

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

/** Square thumbnail with a neutral placeholder when the dish has no photo. */
export function ItemThumb({
  src,
  alt,
  size = 72,
  dimmed = false,
}: {
  src?: string | null;
  alt: string;
  size?: number;
  dimmed?: boolean;
}) {
  return (
    <Box
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: 2,
        overflow: 'hidden',
        bgcolor: 'brand.surfaceMuted',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'text.secondary',
        opacity: dimmed ? 0.5 : 1,
      }}
    >
      {src ? (
        <Box
          component="img"
          src={src}
          alt={alt}
          loading="lazy"
          sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <RestaurantMenuIcon fontSize="small" aria-hidden />
      )}
    </Box>
  );
}
