import { useEffect, useLayoutEffect, useRef } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import BottomNavigation from '@mui/material/BottomNavigation';
import BottomNavigationAction from '@mui/material/BottomNavigationAction';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTranslation } from 'react-i18next';

import { useAppTheme } from '@/theme';
import { pickLogo } from '@/theme/tokens';
import {
  IconHome,
  IconOrders,
  IconChat,
  IconInfo,
  IconRoom,
  type AppIconComponent,
} from '@/icons';
import { fadeInSx } from '@/kit';
import { GuestQuickMenu } from '../components/GuestQuickMenu';
import { RoomMenu } from '../components/RoomMenu';
import { useGuestHome } from '../hooks/useGuestQueries';
import { useGuestSession } from '../session/GuestSessionProvider';
import { useCart } from '../state/cart';
import { CartPage } from '../pages/CartPage';
import { GuestTopBar } from './GuestTopBar';
import { layout as storefrontLayout, surfaceRadius } from '../storefrontTokens';
import { useStorefront } from '../useStorefront';
import {
  BOTTOM_NAV_HEIGHT,
  BOTTOM_NAV_INSET,
  BOTTOM_NAV_SPACE,
  CART_WIDTH,
  CONTENT_MAX,
  DESKTOP_QUERY,
} from './constants';

export { BOTTOM_NAV_HEIGHT, BOTTOM_NAV_SPACE, DESKTOP_QUERY } from './constants';

interface NavTab {
  value: string;
  Icon: AppIconComponent;
  labelKey: string;
}

// Same roles as the bottom nav — one testid per role, whatever the viewport,
// so E2E scenarios don't fork by width. Grouped for the rail («Отель»).
// «Меню» больше не раздел: плоского каталога отеля не существует, меню живёт
// внутри заведения и открывается его плиткой на главной.
const PRIMARY_TABS: NavTab[] = [
  { value: '/home', Icon: IconHome, labelKey: 'guest.nav.home' },
  { value: '/orders', Icon: IconOrders, labelKey: 'guest.nav.orders' },
];
const HOTEL_TABS: NavTab[] = [
  { value: '/chat', Icon: IconChat, labelKey: 'guest.nav.chat' },
  { value: '/info', Icon: IconInfo, labelKey: 'guest.nav.info' },
];
// Управление номером — платный модуль отеля и раздел, которому нужен номер.
// Живёт отдельной константой, чтобы гейт был виден в одном месте, а не
// растворился в фильтре по всему массиву.
const ROOM_TAB: NavTab = { value: '/room', Icon: IconRoom, labelKey: 'guest.nav.room' };
const TOP_BAR_HEIGHT = storefrontLayout.topBar;

/**
 * Один шелл на все экраны витрины, адаптивный по ширине.
 *
 * Общая логика (сессия, счётчик непрочитанного, активный раздел) считается
 * один раз; различается только обвязка: до 1024 — нижнее стеклянное меню и
 * плавающие чипы, от 1024 — ВЕРХНЯЯ стеклянная строка (R5; левый рельс убран:
 * он съедал ширину на экране, где ценность — кадры заведений во всю ширину).
 * Корзина — колонка справа на десктопе и отдельный экран на телефоне.
 */
/**
 * Нижний край плавающей группы — в переменную CSS.
 *
 * Липкие полосы экранов пинятся ПОД группой, и раньше они считали её край
 * сами: `floatingTop + высота`. Совпадало ровно до первого телефона с вырезом —
 * там группа стоит с добавкой безопасной зоны, съезжает вниз примерно на 47 px
 * и ложится на плиту плана. Эмуляция такого не показывает, поэтому дефект
 * дожил до живого устройства.
 *
 * Теперь край ИЗМЕРЯЕТСЯ и раздаётся всем: любой вырез, любая высота группы,
 * любой шрифт — полосы следуют за реальным элементом, а не за арифметикой.
 */
function useFloatingBottom() {
  const ref = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const publish = () => {
      const bottom = Math.round(node.getBoundingClientRect().bottom);
      document.documentElement.style.setProperty('--guest-floating-bottom', `${bottom}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    window.addEventListener('resize', publish);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', publish);
      // Группы больше нет (десктоп) — полосы обязаны вернуться к умолчанию.
      document.documentElement.style.removeProperty('--guest-floating-bottom');
    };
  }, []);

  return ref;
}

export function GuestLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { session, hotel, isReady, isBootstrapping } = useGuestSession();
  const { tokens, mode } = useAppTheme();
  const { glass } = useStorefront();
  const home = useGuestHome();
  const unreadChat = home.data?.unread_chat ?? 0;
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  // ВСЕ хуки — до ранних возвратов. useCart() стоял после них: пока корзина
  // была одна на отель и не перерисовывалась, порядок вызовов случайно
  // совпадал; с посервисной корзиной (R5) он поехал, и React справедливо
  // ругался на смену порядка хуков.
  const cart = useCart();
  const floatingRef = useFloatingBottom();

  const hotelName = hotel?.name ?? session?.hotel.name ?? '';

  useEffect(() => {
    if (hotelName) document.title = hotelName;
  }, [hotelName]);

  if (isBootstrapping) {
    return (
      <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', bgcolor: 'background.default' }}>
        <CircularProgress aria-label={t('guest.common.loading')} />
      </Box>
    );
  }
  if (!isReady) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }

  const room = session?.room ?? null;
  // Пункт «Номер» показывается при ДВУХ условиях сразу:
  //
  //  * модуль включён у отеля — иначе раздела не существует, и сервер ответит
  //    403 на маршрут, а не отдаст пустой экран;
  //  * у сессии есть номер — в режиме «просто посмотреть» управлять нечем, и
  //    ссылка вела бы в никуда. Это единственное, что мы делаем с режимом
  //    просмотра: не показываем бессмысленную ссылку. Сам режим не трогаем.
  const roomControl = Boolean(session?.hotel.room_control_enabled ?? hotel?.room_control_enabled);
  const TABS = [...PRIMARY_TABS, ...HOTEL_TABS, ...(roomControl && room ? [ROOM_TAB] : [])];

  const activeTab = TABS.find((tab) => location.pathname.startsWith(tab.value))?.value ?? false;
  const badgeFor = (value: string) => (value === '/chat' ? unreadChat : 0);
  // Корзина — колонка справа на десктопе, видна только с непустым заказом.
  const cartOpen = isDesktop && !cart.isEmpty;
  const content = (
    <Box key={location.pathname} sx={fadeInSx()}>
      <Outlet />
    </Box>
  );

  // ── Планшет и десктоп: верхняя стеклянная строка, контент, корзина колонкой ──
  if (isDesktop) {
    return (
      <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default' }}>
        <GuestTopBar
          hotelName={hotelName}
          logo={pickLogo(tokens, mode) ?? null}
          tabs={TABS.map((tab) => ({ value: tab.value, labelKey: tab.labelKey }))}
          active={activeTab}
          room={room}
          cartCount={cart.count}
          unreadChat={unreadChat}
          onNavigate={navigate}
          onOpenCart={() => navigate('/cart')}
        />
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: cartOpen
              ? `minmax(0, ${CONTENT_MAX}px) ${CART_WIDTH}px`
              : `minmax(0, ${CONTENT_MAX}px)`,
            justifyContent: 'center',
            minHeight: `calc(100dvh - ${TOP_BAR_HEIGHT}px)`,
          }}
        >
          <Box component="main" sx={{ minWidth: 0 }}>
            {content}
          </Box>
          {cartOpen ? <CartPage variant="column" /> : null}
        </Box>
      </Box>
    );
  }

  // ── Phone / tablet: floating controls + bottom bar (unchanged behaviour) ──
  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default', display: 'flex', flexDirection: 'column' }}>
      <Stack
        ref={floatingRef}
        direction="row"
        spacing={0.5}
        alignItems="center"
        sx={(th) => ({
          position: 'fixed',
          top: `calc(${storefrontLayout.floatingTop}px + env(safe-area-inset-top, 0px))`,
          insetInlineEnd: 12,
          zIndex: th.zIndex.appBar + 2,
          borderRadius: (theme) => surfaceRadius.pill(theme.palette.brand.radius),
          minHeight: storefrontLayout.floatingHeight,
          px: 0.5,
          // Плавающая группа и отдельный чип номера рядом были из разных
          // источников стиля — стеклянная группа и плотный чип. Теперь оба
          // берут стекло из словаря витрины и выглядят одним слоем.
          ...glass.chip,
          boxShadow: th.shadows[6],
        })}
      >
        {/* Без номера чип не исчезает, а становится входом по номеру:
            иначе из режима просмотра некуда вернуться. */}
        <RoomMenu room={room} variant="floating" />
        {/* Язык и тема — под одной кнопкой. Полоса `fixed` висит над контентом
            любого экрана, и тремя кнопками она накрывала то заголовок, то
            первую строку списка. Чип номера остался снаружи: он статус, а не
            настройка. */}
        <GuestQuickMenu />
      </Stack>

      {/* Место под плавающее меню: его высота плюс отступы сверху и снизу. */}
      <Box
        component="main"
        sx={{ flexGrow: 1, pb: `${BOTTOM_NAV_SPACE}px` }}
      >
        {content}
      </Box>

      {/*
        Нижнее меню — ПЛАВАЮЩИЙ блок, скруглённый со всех сторон, а не полоса
        во всю ширину с прямыми углами. Прежняя полоса упиралась в края экрана
        и обрывалась прямым краем ровно там, где остальная витрина скруглена:
        карточки, панели, липкая строка категорий. Меню — такая же поверхность,
        и выпадать из общей пластики ему незачем.

        Отступ снизу считается от безопасной зоны, а не задан числом: на
        телефоне с домашней полосой блок обязан встать НАД ней, иначе жест
        «домой» приходится делать поверх кнопок.
      */}
      <Paper
        elevation={0}
        sx={(th) => ({
          position: 'fixed',
          insetInline: `${BOTTOM_NAV_INSET}px`,
          bottom: `calc(${BOTTOM_NAV_INSET}px + env(safe-area-inset-bottom, 0px))`,
          zIndex: th.zIndex.appBar + 1,
          border: 1,
          borderColor: 'divider',
          borderRadius: surfaceRadius.panel(th.palette.brand.radius),
          overflow: 'hidden',
          maxWidth: 720,
          mx: 'auto',
          // Прототип держит нижнее меню ЗАМЕТНО прозрачнее (.6 + blur 28), чем
          // почти глухие .94: под меню должен продолжаться контент, иначе
          // накладной слой читается как вторая страница.
          ...glass.sheet,
        })}
      >
        <BottomNavigation
          showLabels
          value={activeTab}
          onChange={(_event, value: string) => navigate(value)}
          sx={{ height: BOTTOM_NAV_HEIGHT, bgcolor: 'transparent' }}
        >
          {TABS.map((tab) => (
            <BottomNavigationAction
              key={tab.value}
              value={tab.value}
              label={t(tab.labelKey)}
              data-testid={`guest-nav-${tab.value.slice(1)}`}
              icon={
                badgeFor(tab.value) ? (
                  <Badge badgeContent={unreadChat} color="error" max={99} data-testid="guest-chat-unread">
                    <tab.Icon size={22} />
                  </Badge>
                ) : (
                  <tab.Icon size={22} />
                )
              }
              sx={{ minWidth: 44 }}
            />
          ))}
        </BottomNavigation>
      </Paper>
    </Box>
  );
}
