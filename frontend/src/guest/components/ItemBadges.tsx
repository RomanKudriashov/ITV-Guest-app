import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import { useTranslation } from 'react-i18next';

import { badgeRoleColor } from '@/kit/chips';
import type { MenuBadge } from '../api/types';

/**
 * Marketing badges of a menu item, rendered as small filled chips sorted by
 * `sort_order`. The fill color is a theme token chosen by the badge's role via the
 * kit's `badgeRoleColor`; the text color is `getContrastText` of that fill, so the
 * label stays readable on any role, light or dark. `label` is already localized.
 */
export function ItemBadges({
  badges,
  size = 'md',
}: {
  badges?: MenuBadge[];
  size?: 'sm' | 'md';
}) {
  if (!badges?.length) return null;
  const sorted = [...badges].sort((a, b) => a.sort_order - b.sort_order);
  const small = size === 'sm';
  return (
    <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
      {sorted.map((badge, index) => (
        <Box
          key={`${badge.label}-${index}`}
          data-testid={`guest-badge-${index}`}
          sx={(theme) => {
            const fill = badgeRoleColor(badge.color_role, theme);
            return {
              display: 'inline-flex',
              alignItems: 'center',
              px: small ? 0.75 : 1,
              py: 0.25,
              borderRadius: `${theme.palette.brand.radius.pill}px`,
              bgcolor: fill,
              color: theme.palette.getContrastText(fill),
              fontSize: small ? '0.68rem' : '0.72rem',
              fontWeight: theme.typography.fontWeightBold,
              lineHeight: 1.4,
            };
          }}
        >
          {badge.label}
        </Box>
      ))}
    </Stack>
  );
}

/** "~{n} мин" prep-time chip, shown only when the item carries `prep_minutes`. */
export function PrepMinutesChip({ minutes }: { minutes?: number | null }) {
  const { t } = useTranslation();
  if (minutes == null) return null;
  return (
    <Box
      data-testid="guest-prep-minutes"
      sx={(theme) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.375,
        px: 0.875,
        height: 24,
        borderRadius: `${theme.palette.brand.radius.pill}px`,
        border: 1,
        borderColor: 'divider',
        color: 'text.secondary',
        bgcolor: theme.palette.brand.surfaceMuted,
        fontSize: '0.72rem',
        lineHeight: 1,
        whiteSpace: 'nowrap',
      })}
    >
      <AccessTimeIcon sx={{ fontSize: 14 }} />
      <span>{t('guest.item.prepMinutes', { minutes })}</span>
    </Box>
  );
}
