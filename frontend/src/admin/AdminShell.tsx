import { useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import MenuIcon from '@mui/icons-material/Menu';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTranslation } from 'react-i18next';

import { ThemeModeToggle } from '@/components/ThemeModeToggle';
import { useAppTheme } from '@/theme';
import { adminCssVars, accent, ink, layout, pageBackground, state, surface } from './adminTokens';
import type { PlatformMe } from './adminClient';

export interface AdminSection {
  key: string;
  labelKey: string;
  group?: string;
  badge?: number;
}

/**
 * Каркас корневой админки: левая навигация, верхняя строка, содержимое.
 *
 * Навигация СЛЕВА и постоянная — в отличие от гостевой витрины, где рельс убран
 * (R5). Причины разные и обе продуктовые: у гостя ценность в кадрах заведений
 * во всю ширину, здесь — в быстром переходе между реестрами, и постоянный
 * список разделов дешевле любой всплывающей навигации.
 *
 * Разделы сгруппированы, как в CMS (R4): плоская простыня одинаковых пунктов
 * не даёт понять, что здесь про отели, а что про саму платформу.
 */
export function AdminShell({
  sections,
  active,
  onNavigate,
  me,
  onLogout,
  crumb,
  children,
}: {
  sections: AdminSection[];
  active: string;
  onNavigate: (key: string) => void;
  me: PlatformMe | null;
  onLogout: () => void;
  crumb: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { mode } = useAppTheme();
  const isNarrow = useMediaQuery('(max-width:899px)');
  const [navOpen, setNavOpen] = useState(false);
  const groups = sections.reduce<{ group: string | undefined; items: AdminSection[] }[]>(
    (acc, section) => {
      const last = acc[acc.length - 1];
      if (last && last.group === section.group) last.items.push(section);
      else acc.push({ group: section.group, items: [section] });
      return acc;
    },
    [],
  );

  // Одна и та же разметка навигации служит и постоянной панели, и шторке:
  // две копии списка разделов однажды разъехались бы.
  const navigation = (
    <>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, p: '20px 18px 16px' }}>
          <Box
            sx={{
              width: 28,
              height: 28,
              borderRadius: '8px',
              background: `linear-gradient(135deg,${accent.main},${accent.deep})`,
              display: 'grid',
              placeItems: 'center',
              fontWeight: 800,
              fontSize: 14,
              color: accent.onBrand,
            }}
          >
            IT
          </Box>
          <Box>
            <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: accent.onBrand, lineHeight: 1.2 }}>
              {t('admin.brand.name')}
            </Typography>
            <Typography
              sx={{ fontSize: 10, color: ink.low, letterSpacing: '.14em', textTransform: 'uppercase' }}
            >
              {t('admin.brand.tagline')}
            </Typography>
          </Box>
        </Box>

        {groups.map((group, index) => (
          <Box key={group.group ?? `top-${index}`}>
            {group.group ? (
              <Typography
                sx={{
                  fontSize: 10,
                  letterSpacing: '.18em',
                  textTransform: 'uppercase',
                  color: ink.low,
                  fontWeight: 700,
                  p: '14px 18px 6px',
                }}
              >
                {t(group.group)}
              </Typography>
            ) : null}
            {group.items.map((section) => (
              <ButtonBase
                key={section.key}
                onClick={() => onNavigate(section.key)}
                data-testid={`admin-nav-${section.key}`}
                data-active={active === section.key ? 'true' : undefined}
                sx={{
                  display: 'flex',
                  width: 'calc(100% - 20px)',
                  justifyContent: 'flex-start',
                  gap: 1.4,
                  m: '1px 10px',
                  p: '9px 11px',
                  borderRadius: '10px',
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: active === section.key ? accent.soft : ink.mid,
                  bgcolor: active === section.key ? accent.wash : 'transparent',
                  '&:hover': { bgcolor: active === section.key ? accent.wash : surface.s2 },
                }}
              >
                {t(section.labelKey)}
                {section.badge ? (
                  <Box
                    sx={{
                      ml: 'auto',
                      fontSize: 10,
                      fontWeight: 700,
                      bgcolor: surface.s3,
                      color: ink.mid,
                      borderRadius: 999,
                      px: 0.9,
                    }}
                  >
                    {section.badge}
                  </Box>
                ) : null}
              </ButtonBase>
            ))}
          </Box>
        ))}

        <Box
          sx={{
            mt: 'auto',
            p: '14px 18px',
            borderTop: `1px solid ${surface.hair}`,
            display: 'flex',
            alignItems: 'center',
            gap: 1.25,
          }}
        >
          <Box
            sx={{
              width: 30,
              height: 30,
              borderRadius: '50%',
              background: `linear-gradient(135deg,${accent.main},${accent.deep2})`,
              display: 'grid',
              placeItems: 'center',
              fontSize: 11,
              fontWeight: 700,
              color: accent.onBrand,
            }}
          >
            {(me?.email ?? '?').slice(0, 2).toUpperCase()}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography noWrap sx={{ fontSize: 12.5, fontWeight: 600 }} data-testid="admin-me-email">
              {me?.email ?? '—'}
            </Typography>
            <Typography sx={{ fontSize: 10.5, color: ink.low }} data-testid="admin-me-role">
              {me ? t(`admin.role.${me.role}`) : ''}
            </Typography>
          </Box>
          {/* Признак 2FA виден постоянно: это мастер-ключ ко всем отелям, и
              «второй фактор не включён» должно мозолить глаза, а не прятаться
              в настройках. */}
          <Box
            sx={{ ml: 'auto', fontSize: 10, fontWeight: 700, color: me?.totp_enabled ? accent.soft : state.warn }}
            data-testid="admin-me-2fa"
          >
            {me?.totp_enabled ? t('admin.security.on') : t('admin.security.off')}
          </Box>
        </Box>
    </>
  );

  return (
    <Box
      data-testid="admin-shell"
      sx={{
        minHeight: '100dvh',
        // Переменные админки — здесь, на корне: всё дерево ниже читает их
        // имена и переключается вместе с темой.
        ...adminCssVars(mode),
        background: pageBackground,
        color: ink.hi,
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: `${layout.nav}px 1fr` },
      }}
    >
      {/*
        На узком экране навигация уезжает в шторку. До этого её попросту не
        было: панель скрывалась через `display: none`, а замены не появилось —
        разделы админки на телефоне были недостижимы вовсе.
      */}
      {isNarrow ? (
        <Drawer
          open={navOpen}
          onClose={() => setNavOpen(false)}
          ModalProps={{ keepMounted: true }}
          PaperProps={{ sx: { width: layout.nav, bgcolor: surface.s1, color: ink.hi } }}
        >
          <Box
            sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}
            onClick={() => setNavOpen(false)}
            data-testid="admin-nav-drawer"
          >
            {navigation}
          </Box>
        </Drawer>
      ) : null}

      <Box
        component="aside"
        sx={{
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          bgcolor: surface.s1,
          borderRight: `1px solid ${surface.line}`,
        }}
      >
        {navigation}
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Box
          sx={{
            height: layout.topBar,
            flex: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 1.75,
            px: 3,
            bgcolor: surface.bar,
            backdropFilter: 'blur(24px) saturate(1.5)',
            borderBottom: `1px solid ${surface.hair}`,
          }}
        >
          <IconButton
            onClick={() => setNavOpen(true)}
            data-testid="admin-nav-toggle"
            aria-label={t('admin.nav.open')}
            sx={{ display: { xs: 'inline-flex', md: 'none' }, color: ink.mid, ml: -1 }}
          >
            <MenuIcon />
          </IconButton>
          <Box sx={{ fontSize: 13, color: ink.low }} data-testid="admin-crumb">
            {crumb}
          </Box>
          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
            <ThemeModeToggle />
            <ButtonBase
              onClick={onLogout}
              data-testid="admin-logout"
              sx={{ fontSize: 12.5, fontWeight: 600, color: ink.mid, px: 1.25, py: 0.75, borderRadius: 1 }}
            >
              {t('admin.actions.logout')}
            </ButtonBase>
          </Box>
        </Box>

        <Box component="main" sx={{ flex: 1, overflowY: 'auto', p: 3, minWidth: 0 }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
}
