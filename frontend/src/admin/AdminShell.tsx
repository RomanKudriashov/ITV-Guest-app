import { useState, type MouseEvent, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import MenuIcon from '@mui/icons-material/MenuOutlined';
import Divider from '@mui/material/Divider';
import Tooltip from '@mui/material/Tooltip';
import { useTheme } from '@mui/material/styles';
import KeyboardDoubleArrowLeftOutlinedIcon from '@mui/icons-material/KeyboardDoubleArrowLeftOutlined';
import KeyboardDoubleArrowRightOutlinedIcon from '@mui/icons-material/KeyboardDoubleArrowRightOutlined';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import DevicesOutlinedIcon from '@mui/icons-material/DevicesOutlined';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTranslation } from 'react-i18next';

import { ProfileMenu } from '@/components/ProfileMenu';
import { useNavCollapsed } from '@/hooks/useNavCollapsed';
import { MOTION, usePrefersReducedMotion } from '@/kit/motion';
import { STORAGE_KEYS } from '@/storageKeys';
import { ThemeModeToggle } from '@/components/ThemeModeToggle';
import { accent, ink, layout, pageBackground, shape, surface, typo } from './adminTokens';
import { glassEdge, glassSx } from '@/kit/glass';
import { PageBackdrop } from '@/components/PageBackdrop';
import { GlassScope, useGlassState } from '@/layouts/glassScope';
import type { PlatformMe } from './adminClient';

export interface AdminSection {
  key: string;
  labelKey: string;
  group?: string;
  badge?: number;
  /** Контурная иконка пункта — в свёрнутом меню пункт узнают по ней (партия 55). */
  icon?: ReactNode;
}

/** Свёрнутое меню — одни иконки, как в CMS (партия 55). */
const NAV_MINI = 64;

/** Текст в DOM, но не на экране: диктору и проверкам по тексту (партия 55). */
const VISUALLY_HIDDEN = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  p: 0,
  m: '-1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;

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
  // Свёрнутость — только у постоянной панели; шторка всегда полная (партия 55).
  const [collapsed, toggleCollapsed] = useNavCollapsed(STORAGE_KEYS.platformNavCollapsed);
  const mini = collapsed && !isNarrow;
  const reduceMotion = usePrefersReducedMotion();
  const theme = useTheme();
  const rtl = theme.direction === 'rtl';
  // Стекло рамки включает экран-образец (партия 56, шаг 1).
  const glass = useGlassState();
  const tipPlacement = rtl ? 'left' : 'right';
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
  const renderNavigation = (mini: boolean) => (
    <>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          p: mini ? '18px 0 14px' : '18px 18px 14px',
          justifyContent: mini ? 'center' : 'flex-start',
          flex: 'none',
        }}
      >
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
          data-testid="admin-brand-mark"
          aria-hidden
        >
          {/* Буквы NaviRoom Control (партия 53); до неё здесь стояло «IT» от ITV. */}
          NC
        </Box>
        <Box sx={mini ? VISUALLY_HIDDEN : { minWidth: 0 }}>
          {/*
            Название платформы — обычный текст на поверхности, а не надпись на
            заливке. Оно и раньше красилось `on-brand`, но заливки под ним нет:
            на светлой теме это давало белым по белому, контраст 1.00, и
            название просто отсутствовало на экране.
          */}
          <Typography noWrap sx={{ ...typo.panelTitle, color: ink.hi }}>
            {t('admin.brand.name')}
          </Typography>
        </Box>
      </Box>

      {/* Своя прокрутка у списка: шапка с маркой и кнопка внизу на месте (партия 55). */}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
      {groups.map((group, index) => (
        <Box key={group.group ?? `top-${index}`} sx={{ mb: 0.5 }}>
          {/* В свёрнутом меню группы делит черта, слово остаётся диктору. */}
          {group.group && mini ? <Divider sx={{ mx: 1.5, my: 1, borderColor: surface.line }} /> : null}
          {group.group ? (
            <Typography sx={mini ? VISUALLY_HIDDEN : { ...typo.label, color: ink.low, p: '14px 18px 6px' }}>
              {t(group.group)}
            </Typography>
          ) : null}
          {group.items.map((section) => (
            <Tooltip
              key={section.key}
              title={mini ? t(section.labelKey) : ''}
              placement={tipPlacement}
              // Имя ссылки — её текст; пустой title без этого стирал бы его.
              describeChild
            >
            <ButtonBase
              /*
                НАСТОЯЩАЯ ССЫЛКА, А НЕ КНОПКА.

                Пункты были `<button>` без `href`, и раздел нельзя было открыть
                в новой вкладке ни средним кликом, ни с Cmd — браузеру нечего
                было открывать. При этом адрес раздела существует и работает:
                `/admin?section=team` в чистой вкладке открывает «Пользователей».
                То есть ссылка была, а воспользоваться ею было нельзя.

                Обычный клик по-прежнему идёт через `onNavigate` — переход
                внутри приложения, без перезагрузки; `preventDefault` нужен
                только для него. Клик с модификатором и средней кнопкой браузер
                обрабатывает сам, и `href` ему для этого достаточно.
              */
              component="a"
              href={`?section=${section.key}`}
              onClick={(event: MouseEvent) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                event.preventDefault();
                onNavigate(section.key);
              }}
              data-testid={`admin-nav-${section.key}`}
              data-active={active === section.key ? 'true' : undefined}
              sx={{
                display: 'flex',
                position: 'relative',
                width: 'calc(100% - 20px)',
                justifyContent: mini ? 'center' : 'flex-start',
                alignItems: 'center',
                gap: 1.4,
                m: '1px 10px',
                p: mini ? '9px 0' : '9px 12px',
                borderRadius: `${shape.radius}px`,
                ...typo.body,
                fontWeight: 600,
                textAlign: 'start',
                color: active === section.key ? accent.soft : ink.mid,
                bgcolor: active === section.key ? accent.wash : 'transparent',
                '&:hover': { bgcolor: active === section.key ? accent.wash : surface.s2 },
              }}
            >
              {section.icon ? (
                <Box component="span" aria-hidden sx={{ display: 'inline-flex', flex: 'none' }}>
                  {section.icon}
                </Box>
              ) : null}
              <Box component="span" sx={mini ? VISUALLY_HIDDEN : { minWidth: 0 }}>
                {t(section.labelKey)}
              </Box>
              {section.badge ? (
                <Box
                  sx={{
                    ml: 'auto',
                    // В свёрнутом меню счётчик — на углу иконки.
                    ...(mini ? { position: 'absolute', top: 2, insetInlineEnd: 2, fontSize: 10, px: 0.5 } : null),
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
            </Tooltip>
          ))}
        </Box>
      ))}
      </Box>
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
    <GlassScope value={glass}>
    <Box
      data-testid="admin-shell"
      sx={{
        minHeight: '100dvh',
        // Под стеклом — подложка-градиент (свой слой), а не ровный фон.
        background: glass.on ? 'transparent' : pageBackground,
        isolation: 'isolate',
        color: ink.hi,
        display: 'grid',
        // Содержимое сдвигается вместе с шириной панели (партия 55).
        gridTemplateColumns: { xs: '1fr', md: `${mini ? NAV_MINI : layout.nav}px 1fr` },
        transition: reduceMotion
          ? 'none'
          : `grid-template-columns ${MOTION.duration.base}ms ${MOTION.easing.entrance}`,
      }}
    >
      {glass.on ? <PageBackdrop /> : null}
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
            {renderNavigation(false)}
          </Box>
        </Drawer>
      ) : null}

      {/*
        Панель ЛИПКАЯ, со своей прокруткой (партия 55): на длинном реестре
        страница уезжала вниз вместе с меню, и до разделов приходилось
        листать обратно.
      */}
      <Box
        component="aside"
        data-testid="admin-nav"
        data-collapsed={mini ? 'true' : undefined}
        sx={{
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          position: 'sticky',
          top: 0,
          height: '100dvh',
          minWidth: 0,
          overflow: 'hidden',
          ...(glass.on
            ? { ...glassSx(theme, 'panel', { edge: false, shadow: false }), borderRight: glassEdge(theme) }
            : { bgcolor: surface.s1, borderRight: `1px solid ${surface.line}` }),
        }}
      >
        {renderNavigation(mini)}
        <Box
          sx={{
            flex: 'none',
            borderTop: `1px solid ${surface.line}`,
            display: 'flex',
            justifyContent: mini ? 'center' : 'flex-end',
            p: 1,
          }}
        >
          <Tooltip title={t(mini ? 'admin.nav.expand' : 'admin.nav.collapse')} placement={tipPlacement}>
            <IconButton
              size="small"
              onClick={toggleCollapsed}
              data-testid="admin-nav-collapse"
              aria-label={t(mini ? 'admin.nav.expand' : 'admin.nav.collapse')}
              aria-expanded={!mini}
              sx={{ color: ink.mid }}
            >
              {/* Стрелка — к краю, куда уедет панель; в RTL зеркально. */}
              {mini !== rtl ? (
                <KeyboardDoubleArrowRightOutlinedIcon fontSize="small" />
              ) : (
                <KeyboardDoubleArrowLeftOutlinedIcon fontSize="small" />
              )}
            </IconButton>
          </Tooltip>
        </Box>
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
            ...(glass.on
              ? {
                  // Липкая: под ней проходит реестр — размытию есть что размывать.
                  position: 'sticky',
                  top: 0,
                  zIndex: 2,
                  ...glassSx(theme, 'bar', { edge: false, shadow: false }),
                  borderBottom: glassEdge(theme),
                }
              : {
                  bgcolor: surface.bar,
                  backdropFilter: 'blur(24px) saturate(1.5)',
                  borderBottom: `1px solid ${surface.hair}`,
                }),
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
    </GlassScope>
  );
}
