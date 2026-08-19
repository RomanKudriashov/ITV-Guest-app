import { useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import MenuIcon from '@mui/icons-material/Menu';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import DevicesOutlinedIcon from '@mui/icons-material/DevicesOutlined';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTranslation } from 'react-i18next';

import { ProfileMenu } from '@/components/ProfileMenu';
import { ThemeModeToggle } from '@/components/ThemeModeToggle';
import { accent, ink, layout, pageBackground, shape, surface, typo } from './adminTokens';
import type { PlatformMe } from './adminClient';

export interface AdminSection {
  key: string;
  labelKey: string;
  group?: string;
  badge?: number;
}

/**
 * Каркас консоли: левая навигация, верхняя строка, содержимое.
 *
 * Навигация СЛЕВА и постоянная — в отличие от гостевой витрины, где рельс убран
 * (R5). Причины разные и обе продуктовые: у гостя ценность в кадрах заведений
 * во всю ширину, здесь — в быстром переходе между реестрами, и постоянный
 * список разделов дешевле любой всплывающей навигации.
 *
 * Разделы сгруппированы, как в CMS (R4): плоская простыня одинаковых пунктов
 * не даёт понять, что здесь про отели, а что про саму платформу.
 *
 * БЛОК ПРОФИЛЯ — В ШАПКЕ, а не внизу панели. Внизу он стоял в колонке 248px,
 * из которых на текст оставалось 73: адрес обрезался на середине, роль и
 * признак второго фактора ломались на две строки каждый, и всё вместе читалось
 * лесенкой. В шапке места ровно столько, сколько нужно монограмме, а адрес
 * целиком показывает меню — см. `ProfileMenu`.
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
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, p: '18px 18px 14px' }}>
        <Box
          sx={{
            width: 30,
            height: 30,
            flex: 'none',
            borderRadius: `${shape.radiusSmall}px`,
            background: `linear-gradient(135deg,${accent.main},${accent.deep})`,
            display: 'grid',
            placeItems: 'center',
            fontWeight: 800,
            fontSize: 13,
            color: accent.onBrand,
          }}
        >
          IT
        </Box>
        <Box sx={{ minWidth: 0 }}>
          {/*
            Название платформы — обычный текст на поверхности, а не надпись на
            заливке. Оно и раньше красилось `on-brand`, но заливки под ним нет:
            на светлой теме это давало белым по белому, контраст 1.00, и
            название просто отсутствовало на экране.
          */}
          <Typography noWrap sx={{ ...typo.panelTitle, color: ink.hi }}>
            {t('admin.brand.name')}
          </Typography>
          <Typography noWrap sx={{ ...typo.label, fontSize: 10, color: ink.low }}>
            {t('admin.brand.tagline')}
          </Typography>
        </Box>
      </Box>

      {groups.map((group, index) => (
        <Box key={group.group ?? `top-${index}`} sx={{ mb: 0.5 }}>
          {group.group ? (
            <Typography sx={{ ...typo.label, color: ink.low, p: '14px 18px 6px' }}>
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
                p: '9px 12px',
                borderRadius: `${shape.radius}px`,
                ...typo.body,
                fontWeight: 600,
                textAlign: 'start',
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
                    ...typo.label,
                    letterSpacing: 0,
                    bgcolor: surface.s3,
                    color: ink.mid,
                    borderRadius: `${shape.pill}px`,
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
    </>
  );

  const profile = (
    <ProfileMenu
      testIdPrefix="admin"
      email={me?.email ?? '—'}
      role={me ? t(`admin.role.${me.role}`) : ''}
      /*
        Признак второго фактора остаётся ПОСТОЯННО ВИДИМЫМ — меткой на
        монограмме. Он заводился ровно ради того, чтобы мозолить глаза: это
        мастер-ключ ко всем отелям, и «второй фактор не включён» нельзя убирать
        под клик вместе с остальным блоком профиля.
      */
      warning={
        me && !me.totp_enabled
          ? { label: t('admin.security.off'), testId: 'admin-me-2fa-warning' }
          : null
      }
      items={[
        {
          key: 'sessions',
          label: t('sessions.title'),
          icon: <DevicesOutlinedIcon fontSize="small" />,
          onSelect: () => onNavigate('security'),
        },
        {
          key: 'security',
          label: t('admin.nav.security'),
          icon: <ShieldOutlinedIcon fontSize="small" />,
          onSelect: () => onNavigate('security'),
        },
      ]}
      onLogout={onLogout}
      logoutLabel={t('admin.actions.logout')}
    />
  );

  return (
    <Box
      data-testid="admin-shell"
      sx={{
        minHeight: '100dvh',
        background: pageBackground,
        color: ink.hi,
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: `${layout.nav}px 1fr` },
      }}
    >
      {/*
        На узком экране навигация уезжает в шторку. До этого её попросту не
        было: панель скрывалась через `display: none`, а замены не появилось —
        разделы консоли на телефоне были недостижимы вовсе.
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
            gap: 1.5,
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
          <Box sx={{ minWidth: 0, color: ink.low }} data-testid="admin-crumb">
            {crumb}
          </Box>
          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
            <ThemeModeToggle />
            {profile}
          </Box>
        </Box>

        <Box component="main" sx={{ flex: 1, overflowY: 'auto', p: 3, minWidth: 0 }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
}
