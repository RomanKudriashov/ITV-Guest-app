import { useTranslation } from 'react-i18next';
import { CMS_ROOT, cmsPath, toCmsRoot } from '@/app/hostRole';

import { ScreenBoundary } from '@/components/ScreenBoundary';

import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import { useState } from 'react';
import Drawer from '@mui/material/Drawer';
import MenuIcon from '@mui/icons-material/MenuOutlined';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme, type Theme } from '@mui/material/styles';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
// Иконки меню — все КОНТУРНЫЕ (партия 55): залитые вперемешку с контурными
// читались как два разных набора.
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import ListAltOutlinedIcon from '@mui/icons-material/ListAltOutlined';
import DashboardCustomizeOutlinedIcon from '@mui/icons-material/DashboardCustomizeOutlined';
import RoomServiceOutlinedIcon from '@mui/icons-material/RoomServiceOutlined';
import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined';
import SupportAgentOutlinedIcon from '@mui/icons-material/SupportAgentOutlined';
import RateReviewOutlinedIcon from '@mui/icons-material/RateReviewOutlined';
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined';
import PaletteOutlinedIcon from '@mui/icons-material/PaletteOutlined';
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined';
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import ScienceOutlinedIcon from '@mui/icons-material/ScienceOutlined';
import BoltOutlinedIcon from '@mui/icons-material/BoltOutlined';
import PeopleAltOutlinedIcon from '@mui/icons-material/PeopleAltOutlined';
import MeetingRoomOutlinedIcon from '@mui/icons-material/MeetingRoomOutlined';
import GroupWorkOutlinedIcon from '@mui/icons-material/GroupWorkOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import KeyOutlinedIcon from '@mui/icons-material/KeyOutlined';
import DevicesOutlinedIcon from '@mui/icons-material/DevicesOutlined';
import KeyboardDoubleArrowLeftOutlinedIcon from '@mui/icons-material/KeyboardDoubleArrowLeftOutlined';
import KeyboardDoubleArrowRightOutlinedIcon from '@mui/icons-material/KeyboardDoubleArrowRightOutlined';

import { MOTION, usePrefersReducedMotion } from '@/kit/motion';
import { STORAGE_KEYS } from '@/storageKeys';
import { useNavCollapsed } from '@/hooks/useNavCollapsed';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ProfileMenu } from '@/components/ProfileMenu';
import { ThemeModeToggle } from '@/components/ThemeModeToggle';
import { useAuth } from '@/auth';
import { isForbidden, useNavigation } from '@/hooks/useNavigation';
import { useBootstrap } from '@/hooks/useBootstrap';
import { NoCmsAccess } from './NoCmsAccess';
import { SectionClosed } from './SectionClosed';
import { allowedSections, sectionOf } from './sectionGate';
import type { SupportSession } from '@/api/types';
import { StaffScale } from '@/theme/StaffScale';
import { glassEdge, glassSx } from '@/kit/glass';
import { PageBackdrop } from '@/components/PageBackdrop';

const DRAWER_WIDTH = 248;
/** Свёрнутое меню — одни иконки (партия 55). */
const DRAWER_MINI = 64;

/**
 * Текст пункта в свёрнутом меню — ВИЗУАЛЬНО скрыт, но в DOM: его читают
 * экранный диктор и проверки по `innerText` пунктов (партия 55).
 * `display: none` убрал бы его из обоих.
 */
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
 * Иконка на ключ раздела. Сам СПИСОК разделов приходит с сервера
 * (`useNavigation`): гейтинг модулями и роль решаются на бэкенде, и держать
 * здесь второй список значило бы держать два источника правды о том, что у
 * отеля есть.
 */
const NAV_ICONS: Record<string, JSX.Element> = {
  dashboard: <DashboardCustomizeOutlinedIcon fontSize="small" />,
  tracker: <ReceiptLongOutlinedIcon fontSize="small" />,
  desk: <SupportAgentOutlinedIcon fontSize="small" />,
  // У «Заказов» своя иконка (партия 55): была запасная, общая с прочими
  // пунктами без иконки.
  orders: <ListAltOutlinedIcon fontSize="small" />,
  services: <RoomServiceOutlinedIcon fontSize="small" />,
  rooms: <MeetingRoomOutlinedIcon fontSize="small" />,
  staff: <PeopleAltOutlinedIcon fontSize="small" />,
  brand: <PaletteOutlinedIcon fontSize="small" />,
  analytics: <InsightsOutlinedIcon fontSize="small" />,
  reviews: <RateReviewOutlinedIcon fontSize="small" />,
  settings: <SettingsOutlinedIcon fontSize="small" />,
  notifications: <NotificationsActiveOutlinedIcon fontSize="small" />,
  dictionaries: <ScienceOutlinedIcon fontSize="small" />,
  marketing: <LocalOfferOutlinedIcon fontSize="small" />,
  roomControl: <BoltOutlinedIcon fontSize="small" />,
  payments: <PaymentsOutlinedIcon fontSize="small" />,
  pms: <GridViewOutlinedIcon fontSize="small" />,
  // Была своя `IconBrand` — палитра, то есть знак «Бренда», а не ключа
  // (партия 55): ключ — контурный, из того же набора.
  mobileKey: <KeyOutlinedIcon fontSize="small" />,
};

const FALLBACK_ICON = <GroupWorkOutlinedIcon fontSize="small" />;

export function AppShell() {
  const location = useLocation();
  // Рамка — стекло на всех экранах (партия 56, шаг 2; правила — kit/glass.ts).
  const glass = { on: true };
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, hotel, logout } = useAuth();
  const navigation = useNavigation();
  // Сводка отеля — ручка панели: линейному сотруднику она ответит 403. Спрашиваем,
  // только когда сервер подтвердил доступ к панели (DEV-07: без лишних отказов).
  const { data: bootstrap } = useBootstrap(navigation.isSuccess);
  const isNarrow = useMediaQuery((theme: Theme) => theme.breakpoints.down('md'));
  const [navOpen, setNavOpen] = useState(false);
  /*
    СВЁРНУТОЕ МЕНЮ — ТОЛЬКО У ПОСТОЯННОЙ ПАНЕЛИ (партия 55). Шторка на узком
    экране всегда полная: она и так закрыта, пока её не позвали, а иконки без
    подписей под пальцем — угадайка.
  */
  const [collapsed, toggleCollapsed] = useNavCollapsed(STORAGE_KEYS.cmsNavCollapsed);
  const mini = collapsed && !isNarrow;
  const navWidth = mini ? DRAWER_MINI : DRAWER_WIDTH;
  const reduceMotion = usePrefersReducedMotion();
  const widthTransition = reduceMotion
    ? 'none'
    : `width ${MOTION.duration.base}ms ${MOTION.easing.entrance}`;
  const theme = useTheme();
  const rtl = theme.direction === 'rtl';
  // Подпись — в сторону содержимого: справа от панели, в RTL — слева.
  const tipPlacement = rtl ? 'left' : 'right';

  const hotelName = bootstrap?.hotel?.name ?? hotel?.name ?? t('app.title');

  const support = bootstrap?.support_session ?? null;

  /*
    РАЗДЕЛ ЗАКРЫТ РОЛЬЮ — ОТКАЗ, А НЕ ПУСТАЯ ОБОЛОЧКА.

    `/cms/navigation` отвечает линейному сотруднику 403: у повара, горничной и
    консьержа разделов CMS нет ни одного. Дальше оболочка рисовалась как ни в
    чём не бывало — с шапкой, с кнопкой «Добавить сервис», — а панель навигации
    получала `?? []` и молча схлопывалась в ничто. Отказ по правам выглядел как
    сбой загрузки, и уйти отсюда было некуда: ни пункта меню, ни ссылки.

    Пустой список разделов — это тоже «сюда нельзя»: рисовать оболочку вокруг
    несуществующего меню незачем.
  */
  const navGroups = navigation.data?.groups ?? [];
  /*
    РАЗДЕЛОВ НЕТ — И ЭТО ДВА РАЗНЫХ ОТВЕТА, А НЕ ОДИН.

    Линейному сотруднику `/cms/navigation` отвечает 403: у повара, горничной и
    консьержа разделов панели нет ни одного.

      * ОН ПРИШЁЛ В ПАНЕЛЬ — отказ, как и был: рисовать оболочку вокруг
        несуществующего меню незачем, а «Повторить» на отказе по правам
        обещает то, что не сработает никогда.
      * ОН ПРИШЁЛ НА ТРЕКЕР — это его рабочее место, и закрывать его отказом
        нельзя. Оболочка остаётся ради общей шапки, но ПУСТОЙ ПАНЕЛИ НЕТ:
        ни ящика, ни кнопки-гамбургера, ни заголовков групп. Вместо них
        одна строка о том, что разделов у него нет, — чтобы отсутствие меню
        было сказано, а не выглядело недогрузом.
  */
  const noSections =
    isForbidden(navigation.error) || (navigation.isSuccess && navGroups.length === 0);
  const onTracker = location.pathname.startsWith('/tracker');
  // Профиль — тоже свой экран, а не раздел панели: контакты и входы есть у
  // каждого, и повар подключает мессенджер отсюда же.
  const onProfile = location.pathname === cmsPath('/profile');
  if (noSections && !onTracker && !onProfile) {
    return <NoCmsAccess />;
  }
  const showNav = !noSections;
  /*
    ПРЯМОЙ АДРЕС РАЗДЕЛА — СНАЧАЛА ПРАВО, ПОТОМ ЭКРАН (партия 31, DEV-07 QA).
    Пока сервер не ответил, какие разделы открыты, экран раздела не
    монтируется: иначе он успевал выстрелить десятком запросов в закрытые
    ручки (у повара — до 12 ответов 403 в консоли). Раздела нет в ответе —
    одно понятное «раздел закрыт» вместо полуживого экрана с «Не удалось
    загрузить». Серверные 403 остаются второй, настоящей стеной.
  */
  const section = sectionOf(location.pathname, CMS_ROOT);
  const navPending = Boolean(section) && !navigation.isSuccess && !navigation.isError;
  const sectionClosed =
    Boolean(section) && navigation.isSuccess && !allowedSections(navGroups).has(section as string);

  return (
    <StaffScale>
    <Box
      sx={{
        display: 'flex',
        minHeight: '100vh',
        // Под стеклом фон — подложка-градиент (свой слой ниже), а не ровный цвет.
        bgcolor: glass.on ? 'transparent' : 'background.default',
        isolation: 'isolate',
      }}
    >
      {glass.on ? <PageBackdrop /> : null}
      {/*
        ЧУЖОЕ ПРИСУТСТВИЕ. Пока поддержка внутри отеля, отель обязан это
        видеть — и видеть постоянно, а не в разделе, куда надо зайти.
        Полоса закреплена над всем интерфейсом, закрыть её нечем: механизм
        входа под аудитом строился ради разделимости действий, а сторона,
        которую защищают, о вторжении не знала вовсе.
      */}
      {support ? <SupportPresenceBar session={support} /> : null}
      <AppBar
        position="fixed"
        color="inherit"
        sx={[
          {
            zIndex: (theme) => theme.zIndex.drawer + 1,
            borderBottom: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
          },
          // Стекло (партия 56): под шапкой прокручивается содержимое — размытие
          // здесь и работает. Кромка — только снизу, тени нет: шапка — край.
          glass.on
            ? (theme) => ({
                ...glassSx(theme, 'bar', { edge: false, shadow: false }),
                borderBottom: glassEdge(theme),
                boxShadow: 'none',
              })
            : {},
        ]}
      >
        {/*
          На телефоне шапка обязана уместиться (партия 31, DEV-08 QA): зазоры
          по 16 px и поля тулбара выталкивали профиль за край — 373–394 px при
          рабочей ширине 360–375. Узко — зазоры и поля меньше, разделителя нет,
          а длинное имя отеля сжимается многоточием, а не толкает соседей.
        */}
        <Toolbar sx={{ gap: { xs: 0.5, sm: 2 }, px: { xs: 1, sm: 2 } }}>
          {/*
            На узком экране навигация уезжает в выдвижную панель: постоянная
            занимала 246px из 390 и оставляла контенту колонку в одно слово.
            Видно её только там, где она нужна, — на широком экране панель
            и так открыта.
          */}
          {showNav ? (
            <IconButton
              onClick={() => setNavOpen(true)}
              data-testid="nav-toggle"
              aria-label={t('nav.open')}
              sx={{ display: { xs: 'inline-flex', md: 'none' }, ml: -1 }}
            >
              <MenuIcon />
            </IconButton>
          ) : null}
          {/*
            Имя отеля на телефоне — в ДВЕ строки, а не многоточием (партия 55):
            на 390 «Отель «Кристалл»» обрезалось, хотя второй строке в шапке
            место есть. Многоточие остаётся только для имён длиннее двух строк.
          */}
          <Typography
            variant="h6"
            data-testid="hotel-name"
            sx={{
              minWidth: 0,
              flexShrink: 1,
              fontSize: { xs: '1rem', sm: undefined },
              lineHeight: { xs: 1.2, sm: 1.6 },
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: { xs: 2, sm: 1 },
              overflow: 'hidden',
              overflowWrap: 'anywhere',
            }}
          >
            {hotelName}
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          <LanguageSwitcher compact />
          <ThemeModeToggle />
          <Divider orientation="vertical" flexItem sx={{ my: 1.5, display: { xs: 'none', sm: 'block' } }} />
          {/*
            Блок пользователя — монограмма с выпадающим меню, тем же, что в
            NaviRoom Control (`ProfileMenu`). Раньше здесь стояла текстовая
            ссылка на профиль, а выход — отдельной иконкой рядом: самый
            разрушительный пункт лежал снаружи, ближе всех к краю, и на узком
            экране первым попадал под палец.
          */}
          <ProfileMenu
            testIdPrefix="cms"
            email={user?.full_name || user?.email || ''}
            role={user?.is_hotel_admin ? t('nav.roleAdmin') : t('nav.roleStaff')}
            items={[
              {
                // Профиль — контакты и входы. Пункт назывался «Мои входы», пока
                // контактов на экране не было.
                key: 'profile',
                label: t('profile.title'),
                icon: <DevicesOutlinedIcon fontSize="small" />,
                onSelect: () => navigate(cmsPath('/profile')),
              },
            ]}
            onLogout={logout}
            logoutLabel={t('auth.logout')}
          />
        </Toolbar>
      </AppBar>

      {showNav ? (
      <Drawer
        variant={isNarrow ? 'temporary' : 'permanent'}
        open={isNarrow ? navOpen : true}
        onClose={() => setNavOpen(false)}
        ModalProps={{ keepMounted: true }}
        data-testid="main-nav-drawer"
        data-collapsed={mini ? 'true' : undefined}
        sx={{
          // Содержимое сдвигается вместе с панелью: ширину держит корень ящика.
          width: isNarrow ? 0 : navWidth,
          flexShrink: 0,
          transition: widthTransition,
          '& .MuiDrawer-paper': {
            width: isNarrow ? DRAWER_WIDTH : navWidth,
            transition: widthTransition,
            overflowX: 'hidden',
            boxSizing: 'border-box',
            borderColor: 'divider',
            // Меню — стекло над подложкой; кромка справа вместо серой черты.
            ...(glass.on
              ? { ...glassSx(theme, 'panel', { edge: false, shadow: false, blur: false }), borderRight: glassEdge(theme) }
              : { borderRight: 1, bgcolor: 'background.paper' }),
          },
        }}
      >
        <Toolbar />
        <List
          sx={{ px: mini ? '8px' : 1.5, py: 2, flex: 1, overflowY: 'auto', overflowX: 'hidden' }}
          data-testid="main-nav"
          onClick={() => setNavOpen(false)}
        >
          {navGroups.map((group, groupIndex) => (
            <Box key={group.key} sx={{ mb: 1.5 }} data-testid={`nav-group-${group.key}`}>
              {/*
                Заголовок группы — не украшение: он и есть починка «плоской
                простыни». Шестнадцать равнозначных пунктов подряд читаются
                как свалка, потому что не отвечают на вопрос «где искать».
                В свёрнутом меню слову места нет — группы делит черта, а слово
                остаётся диктору (партия 55).
              */}
              {mini && groupIndex > 0 ? <Divider sx={{ mx: '4px', mb: 1.5 }} /> : null}
              <Typography
                variant="overline"
                sx={mini ? VISUALLY_HIDDEN : { px: 2, color: 'text.secondary', letterSpacing: '.08em' }}
              >
                {t(`nav.groups.${group.key}`)}
              </Typography>

              {group.items.map((item) => {
                const label = t(`nav.${item.key}`);
                /*
                  «Трекер» (`/tracker`) — предок адресов ресепшена и «моих
                  точек», и NavLink подсвечивал его на всех (партия 55). На
                  ресепшене подсвечен только «Ресепшен»: у трекера `end`, а
                  прочие его подадреса (заказ, мои точки) — явной пометкой.
                */
                const isTracker = item.key === 'tracker';
                const trackerSub =
                  isTracker &&
                  location.pathname.startsWith('/tracker/') &&
                  !location.pathname.startsWith('/tracker/desk');
                return (
                  <Tooltip
                    key={item.key}
                    title={mini ? label : ''}
                    placement={tipPlacement}
                    // Имя пункта — его текст в DOM; подсказка лишь описывает,
                    // иначе пустой title стирал бы имя ссылки.
                    describeChild
                  >
                    <ListItemButton
                      component={NavLink}
                      // Сервер отдаёт КАНОНИЧЕСКИЙ путь раздела (`/cms/...`) — он
                      // про хост клиента не знает и знать не должен. Куда этот
                      // путь положить, решает клиент: на адресе отеля панель живёт
                      // в `/admin`.
                      to={toCmsRoot(item.to)}
                      end={isTracker}
                      data-testid={`cms-nav-${item.key}`}
                      data-active={trackerSub ? 'true' : undefined}
                      sx={{
                        borderRadius: 2,
                        mb: 0.5,
                        position: 'relative',
                        ...(mini ? { justifyContent: 'center', px: 0, minHeight: 40 } : null),
                        '&.active, &[data-active="true"]': {
                          bgcolor: 'brand.surfaceSelected',
                          // Акцент как текст — с планкой 4.5 (партия 55): было 2.63 в тёмной.
                          color: 'brand.primaryText',
                          '& .MuiListItemIcon-root': { color: 'brand.primaryText' },
                        },
                      }}
                    >
                      <ListItemIcon sx={{ minWidth: mini ? 0 : 36 }}>
                        {NAV_ICONS[item.key] ?? FALLBACK_ICON}
                      </ListItemIcon>
                      <ListItemText
                        primary={label}
                        primaryTypographyProps={{ variant: 'body2' }}
                        sx={mini ? VISUALLY_HIDDEN : undefined}
                      />
                    </ListItemButton>
                  </Tooltip>
                );
              })}
            </Box>
          ))}
        </List>
        {/*
          Свернуть/развернуть — внизу панели, у постоянной панели только
          (партия 55): шторка на телефоне всегда полная.
        */}
        {isNarrow ? null : (
          <Box
            sx={{
              flex: 'none',
              borderTop: 1,
              borderColor: 'divider',
              display: 'flex',
              justifyContent: mini ? 'center' : 'flex-end',
              p: 1,
            }}
          >
            <Tooltip title={t(mini ? 'nav.expand' : 'nav.collapse')} placement={tipPlacement}>
              <IconButton
                size="small"
                onClick={toggleCollapsed}
                data-testid="nav-collapse"
                aria-label={t(mini ? 'nav.expand' : 'nav.collapse')}
                aria-expanded={!mini}
                sx={{ color: 'text.secondary' }}
              >
                {/* Стрелка смотрит туда, куда уедет край панели; в RTL — зеркально. */}
                {mini !== rtl ? (
                  <KeyboardDoubleArrowRightOutlinedIcon fontSize="small" />
                ) : (
                  <KeyboardDoubleArrowLeftOutlinedIcon fontSize="small" />
                )}
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </Drawer>
      ) : null}

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0 }}>
        <Toolbar />
        {/*
          СТРОКА ВМЕСТО ПАНЕЛИ — И ВИДНА НА ЛЮБОЙ ШИРИНЕ.

          Стояла в шапке и пряталась на узком (`display: xs none`), потому что
          там тесно. Получалось худшее из двух: панели нет и объяснения тоже
          нет — ровно та пустота без причины, от которой строка и заводилась.
          В содержимом места хватает всем, и прячется она только вместе с самим
          поводом — когда разделы есть.
        */}
        {showNav ? null : (
          <Typography
            variant="caption"
            color="text.secondary"
            data-testid="cms-no-sections"
            sx={{ display: 'block', px: 3, pt: 1.5 }}
          >
            {t('access.noSections')}
          </Typography>
        )}
        {/*
          Граница вокруг СОДЕРЖИМОГО, а не вокруг всего приложения: рельс
          разделов обязан пережить падение экрана, иначе уйти с него можно
          только через адресную строку. Ключ по адресу — переход в другой
          раздел считается новой попыткой.
        */}
        <ScreenBoundary
          key={location.pathname}
          message={t('state.crashed')}
          actionLabel={t('state.reload')}
        >
          {navPending ? null : sectionClosed ? <SectionClosed /> : <Outlet />}
        </ScreenBoundary>
      </Box>
    </Box>
    </StaffScale>
  );
}

/**
 * Полоса присутствия поддержки. Без кнопки закрытия и без кнопки обрыва:
 * отель ВИДИТ сессию, но не рвёт её — иначе разбор инцидента блокируется
 * изнутри того самого отеля, который разбирают.
 */
function SupportPresenceBar({ session }: { session: SupportSession }) {
  const { t, i18n } = useTranslation();
  const time = (iso: string) =>
    new Intl.DateTimeFormat(i18n.resolvedLanguage ?? 'ru', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));

  return (
    <Box
      data-testid="cms-support-presence"
      sx={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: (theme) => theme.zIndex.drawer + 2,
        px: 2,
        py: 0.75,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        fontSize: 13,
        fontWeight: 600,
        color: 'warning.contrastText',
        bgcolor: 'warning.main',
      }}
    >
      {t('app.supportPresence', {
        actor: session.actor,
        from: time(session.started_at),
        until: time(session.expires_at),
      })}
    </Box>
  );
}
