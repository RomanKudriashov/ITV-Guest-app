import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import { useTranslation } from 'react-i18next';

import { OfferingBadge } from '@/kit/chips';
import type { MenuBadge } from '../api/types';

/**
 * Маркетинговые метки позиции, по `sort_order`.
 *
 * Рисует ОБЩИЙ значок кита (`OfferingBadge`) — тот же, которым экран
 * «Маркетинг» показывает метку при настройке. До этого здесь лежала своя
 * копия разметки: считала она то же самое и выглядела так же, но это было
 * совпадение двух копий, а не общий код.
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
  return (
    <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
      {sorted.map((badge, index) => (
        <OfferingBadge
          key={`${badge.label}-${index}`}
          label={badge.label}
          role={badge.color_role}
          size={size}
          testId={`guest-badge-${index}`}
        />
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
