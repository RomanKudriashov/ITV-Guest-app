import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { pressableSx, revealSx } from '@/kit';
import { ICON_REGISTRY, IconServices, type AppIconComponent } from '@/icons';
import type { GuestQuickAction } from '../api/types';

/**
 * The project ships its own line-icon set (`ICON_REGISTRY`), not a Material
 * Symbols font — so the API's Material Symbols name is mapped to the closest
 * registry icon. The constraint that matters is honoured: real vector icons, no
 * emoji. A name already in the registry (`restaurant`, `info`, `chat`) is used
 * as-is; the rest alias to a semantic sibling; anything unknown falls back to a
 * generic icon so a tile is never empty.
 */
const MATERIAL_SYMBOL_ALIASES: Record<string, string> = {
  room_service: 'services',
  event_available: 'slots',
  event: 'slots',
  restaurant_menu: 'restaurant',
  support_agent: 'chat',
  forum: 'chat',
  concierge: 'services',
};

function resolveActionIcon(icon: string): AppIconComponent {
  return ICON_REGISTRY[icon] ?? ICON_REGISTRY[MATERIAL_SYMBOL_ALIASES[icon] ?? ''] ?? IconServices;
}

export interface QuickActionsProps {
  actions: GuestQuickAction[];
}

/**
 * Home quick-action tiles (reference `.q4` / `.qa`). A 4-column grid of tiles,
 * each an accent-soft rounded icon square plus a title, navigating to the action's
 * route. Titles come from i18n (`guest.quickActions.<code>`), with the API `title`
 * as the fallback when a key is missing.
 */
export function QuickActions({ actions }: QuickActionsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  if (!actions.length) return null;

  return (
    <Box
      data-testid="guest-quick-actions"
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 1.5,
      }}
    >
      {actions.map((action, index) => {
        const Icon = resolveActionIcon(action.icon);
        const label = t(`guest.quickActions.${action.code}`, { defaultValue: action.title });
        return (
          <ButtonBase
            key={action.code}
            data-testid={`guest-quick-action-${action.code}`}
            onClick={() => navigate(action.route)}
            focusRipple
            sx={(theme) => ({
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              textAlign: 'start',
              width: '100%',
              height: '100%',
              px: 1.75,
              py: 1.75,
              borderRadius: `${theme.palette.brand.radius.md + 4}px`,
              border: `1px solid ${theme.palette.divider}`,
              bgcolor: theme.palette.background.paper,
              transition: `border-color ${theme.transitions.duration.shorter}ms`,
              '@media (hover: hover)': {
                '&:hover': { borderColor: theme.palette.primary.main },
              },
              ...revealSx({ index }),
              ...pressableSx,
            })}
          >
            <Box
              aria-hidden
              sx={(theme) => ({
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 36,
                height: 36,
                mb: 1.25,
                borderRadius: `${theme.palette.brand.radius.sm + 2}px`,
                bgcolor: theme.palette.brand.primarySoft,
                color: theme.palette.primary.main,
              })}
            >
              <Icon size={18} />
            </Box>
            <Typography
              sx={{
                fontWeight: 700,
                fontSize: '0.8rem',
                lineHeight: 1.25,
                color: 'text.primary',
              }}
            >
              {label}
            </Typography>
          </ButtonBase>
        );
      })}
    </Box>
  );
}
