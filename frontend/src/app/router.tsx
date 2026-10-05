import type { ReactNode } from 'react';
import { Navigate, createBrowserRouter, useLocation, type RouteObject } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { RequireAuth, useAuth } from '@/auth';
import { homePathFor } from '@/auth/home';
import { ScreenBoundary } from '@/components/ScreenBoundary';
import { CMS_ROOT, HOST_ROLE, cmsPath } from '@/app/hostRole';
import { Part, lazyFrom, partLoader } from '@/app/lazyPart';
import { WrongHostNotice } from '@/pages/WrongHostNotice';
import { REFRESH_STORAGE_KEY } from '@/api/client';

/*
  ЭКРАНЫ — ИЗ ЧАСТЕЙ СБОРКИ (партия 35, п.65). Здесь только адреса и лёгкие
  перенаправления; каждый экран приезжает файлом своей части, когда туда
  пошли: гость по QR не качает панель, трекер и консоль. Статический импорт
  экрана сюда снова склеил бы части — его ловит сторож сборки
  `scripts/check-guest-bundle.mjs`.
*/
const guestPart = partLoader(() => import('@/app/parts/guest'));
const loginPart = partLoader(() => import('@/app/parts/login'));
const panelPart = partLoader(() => import('@/app/parts/panel'));
const trackerPart = partLoader(() => import('@/app/parts/tracker'));
const consolePart = partLoader(() => import('@/app/parts/console'));
const landingPart = partLoader(() => import('@/app/parts/landing'));
const devThemePart = partLoader(() => import('@/app/parts/devTheme'));

const GuestRoot = lazyFrom(guestPart, 'GuestRoot');
const GuestLayout = lazyFrom(guestPart, 'GuestLayout');
const EntryPage = lazyFrom(guestPart, 'EntryPage');
const HomePage = lazyFrom(guestPart, 'HomePage');
const CatalogPage = lazyFrom(guestPart, 'CatalogPage');
const VenuePage = lazyFrom(guestPart, 'VenuePage');
const VenueListPage = lazyFrom(guestPart, 'VenueListPage');
const CartPage = lazyFrom(guestPart, 'CartPage');
const ChatPage = lazyFrom(guestPart, 'ChatPage');
const OrdersPage = lazyFrom(guestPart, 'OrdersPage');
const RoomPage = lazyFrom(guestPart, 'RoomPage');
const SearchPage = lazyFrom(guestPart, 'SearchPage');
const OrderStatusPage = lazyFrom(guestPart, 'OrderStatusPage');

const AppShell = lazyFrom(panelPart, 'AppShell');
const LoginPage = lazyFrom(loginPart, 'LoginPage');
const CategoryEditorPage = lazyFrom(panelPart, 'CategoryEditorPage');
const ItemEditorPage = lazyFrom(panelPart, 'ItemEditorPage');
const NotificationsPage = lazyFrom(panelPart, 'NotificationsPage');
const CmsOrdersPage = lazyFrom(panelPart, 'CmsOrdersPage');
const RoomsPage = lazyFrom(panelPart, 'RoomsPage');
const StaffPage = lazyFrom(panelPart, 'StaffPage');
const BrandPage = lazyFrom(panelPart, 'BrandPage');
const ServicesPage = lazyFrom(panelPart, 'ServicesPage');
const ServiceWorkspacePage = lazyFrom(panelPart, 'ServiceWorkspacePage');
const SettingsPage = lazyFrom(panelPart, 'SettingsPage');
const DashboardPage = lazyFrom(panelPart, 'DashboardPage');
const StyleguidePage = lazyFrom(panelPart, 'StyleguidePage');
const AnalyticsPage = lazyFrom(panelPart, 'AnalyticsPage');
const ReviewsPage = lazyFrom(panelPart, 'ReviewsPage');
const MarketingPage = lazyFrom(panelPart, 'MarketingPage');
const QuickActionsPage = lazyFrom(panelPart, 'QuickActionsPage');
const ModulePendingPage = lazyFrom(panelPart, 'ModulePendingPage');
const ProfilePage = lazyFrom(panelPart, 'ProfilePage');
const RoomControlPage = lazyFrom(panelPart, 'RoomControlPage');
const DictionariesPage = lazyFrom(panelPart, 'DictionariesPage');

const TrackerPage = lazyFrom(trackerPart, 'TrackerPage');
const ReceptionDeskPage = lazyFrom(trackerPart, 'ReceptionDeskPage');
const AdminApp = lazyFrom(consolePart, 'AdminApp');
const LandingPage = lazyFrom(landingPart, 'LandingPage');
const DevThemePage = lazyFrom(devThemePart, 'DevThemePage');

/**
 * Начать качать часть ТЕКУЩЕГО адреса, не дожидаясь первого рендера.
 *
 * Иначе цепочка последовательная: входной файл → словарь → рендер → только
 * тогда импорт части. `main.tsx` зовёт это рядом с загрузкой словаря, и часть
 * едет параллельно с ним. Догадка по префиксу адреса — только про заранее:
 * промах стоит лишних байт, а не неверного экрана, экран всё равно решает
 * роутер.
 */
export function preloadPartFor(pathname: string): void {
  const under = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
  if (HOST_ROLE === 'platform') {
    void (under('/admin') ? consolePart() : pathname === '/' ? landingPart() : null);
    return;
  }
  // Без сессии сотрудник увидит вход, а не панель: качать её раньше входа —
  // делить с формой и без того узкий канал.
  const staff = (() => {
    try {
      return Boolean(window.localStorage.getItem(REFRESH_STORAGE_KEY));
    } catch {
      return false;
    }
  })();
  const shell = () => void (staff ? panelPart() : loginPart());
  if (under('/tracker')) {
    shell();
    if (staff) void trackerPart();
  } else if (under('/login')) {
    void loginPart();
  } else if (under(CMS_ROOT) || under('/cms')) {
    shell();
  } else if (HOST_ROLE === 'single' && under('/admin')) {
    void consolePart();
  } else if (!under('/dev')) {
    void guestPart();
  }
}

/** Экран части — под своей заглушкой на время, пока едет её файл. */
const part = (screen: ReactNode) => <Part>{screen}</Part>;

/**
 * Data router — required for `useBlocker` (the unsaved-changes guard in the CMS).
 *
 * Layout of the app:
 *  - `/`         guest storefront (the product);
 *  - `/cms/*` + `/login` staff CMS, unchanged;
 *  - `/tracker`  staff order board — same JWT as the CMS, its own shell
 *                (a cook holds a phone, not a desktop sidebar).
 */
/**
 * Трекер живёт вне оболочки CMS, и граница ему нужна своя: у экрана нет
 * навигации, из которой можно было бы уйти, и падение рендера оставляло бы
 * официанта с белым окном посреди смены.
 */
function DeskScreen() {
  const { t } = useTranslation();
  return (
    <ScreenBoundary message={t('state.crashed')} actionLabel={t('state.reload')}>
      {part(<ReceptionDeskPage />)}
    </ScreenBoundary>
  );
}

function TrackerScreen() {
  const { t } = useTranslation();
  return (
    <ScreenBoundary message={t('state.crashed')} actionLabel={t('state.reload')}>
      {part(<TrackerPage />)}
    </ScreenBoundary>
  );
}

/**
 * ВЕТКИ СОБИРАЮТСЯ ПО РОЛИ АДРЕСА (`app/hostRole.ts`).
 *
 * Корень платформы, адрес отеля и машина разработчика видят РАЗНЫЕ наборы
 * маршрутов — не спрятанные, а отсутствующие. Спрятанный маршрут открывается
 * прямой ссылкой; на этом мы уже обжигались, когда конфигурацию управления
 * номером «убрали с экрана», а ручка осталась.
 */

/*
  ОДНА ОБОЛОЧКА НА ПАНЕЛЬ И ТРЕКЕР.

  Трекер жил отдельной веткой со своим экраном и без левого меню: клик по
  пункту «Трекер» уводил из оболочки, и пунктов меню на экране становилось
  НОЛЬ — замер показывал 12 → 0. Дальше кликать было не по чему, и это читалось
  как «переход не работает».

  Ветка БЕЗ `path` — раскладочная: она даёт общий каркас, а дети несут
  абсолютные адреса. Так `/tracker` остаётся `/tracker` — ни одна ссылка, ни
  один QR и ни один из двух с лишним сотен прогонов не меняются.
*/
const shellChildren: RouteObject[] = [
  {
    path: CMS_ROOT,
    children: [
      { index: true, element: <CmsHome /> },
      { path: 'dashboard', element: part(<DashboardPage />) },
      // Профиль сотрудника: его собственные входы. Не в настройках отеля —
      // те открыты только администратору, а сессии есть у каждого.
      { path: 'profile', element: part(<ProfilePage />) },

      // Структура отеля: сервисы верхним уровнем, меню — внутри сервиса.
      { path: 'services', element: part(<ServicesPage />) },
      { path: 'services/:id', element: part(<ServiceWorkspacePage />) },
      { path: 'rooms', element: part(<RoomsPage />) },
      { path: 'staff', element: part(<StaffPage />) },

      // Редакторы позиции и категории — общие, вызываются из меню сервиса.
      { path: 'menu', element: <Navigate to={cmsPath('/services')} replace /> },
      { path: 'menu/categories/new', element: part(<CategoryEditorPage />) },
      { path: 'menu/categories/:id', element: part(<CategoryEditorPage />) },
      { path: 'menu/items/new', element: part(<ItemEditorPage />) },
      { path: 'menu/items/:id', element: part(<ItemEditorPage />) },

      // Оформление: бренд и витрина — один раздел.
      { path: 'brand', element: part(<BrandPage />) },
      { path: 'analytics', element: part(<AnalyticsPage />) },
      { path: 'reviews', element: part(<ReviewsPage />) },

      // Настройки: сюда растворилась «Коммерция» и переехал справочник локаций.
      { path: 'settings', element: part(<SettingsPage />) },
      { path: 'notifications', element: part(<NotificationsPage />) },
      // Заказы: разбор по всем заведениям. Раздел сам режется по
      // подведомственным точкам, поэтому маршрут общий для админа и
      // управляющего — линейного сюда не пускает гейт CMS.
      //
      // Имя импорта с приставкой: `OrdersPage` уже занят ГОСТЕВЫМ экраном
      // «мои заказы», и это разные вещи — гость смотрит свои, отель смотрит
      // все.
      { path: 'orders', element: part(<CmsOrdersPage />) },
      { path: 'dictionaries', element: part(<DictionariesPage />) },

      // Модульные разделы: пункт в навигации появляется только с модулем,
      // но маршрут существует всегда — иначе прямая ссылка ломалась бы молча.
      { path: 'marketing', element: part(<MarketingPage />) },
      { path: 'room-control', element: part(<RoomControlPage />) },
      // Эти три навигация показывает, а экранов под них ещё нет. Без маршрута
      // адрес проваливался в корневую ветку и уезжал на гостевую главную —
      // админ из своей панели попадал к гостю.
      { path: 'pms', element: part(<ModulePendingPage moduleKey="pms" />) },
      { path: 'payments', element: part(<ModulePendingPage moduleKey="payments" />) },
      { path: 'mobile-key', element: part(<ModulePendingPage moduleKey="mobileKey" />) },

      // Служебное: витрина отдельным адресом больше не нужна (слита с брендом),
      // старые ссылки уводим туда же, а не в 404.
      { path: 'showcase', element: <Navigate to={cmsPath('/brand')} replace /> },
      { path: 'commerce', element: <Navigate to={cmsPath('/settings')} replace /> },
      { path: 'locations', element: <Navigate to={cmsPath('/settings')} replace /> },
      { path: 'departments', element: <Navigate to={cmsPath('/services')} replace /> },
      { path: 'quick-actions', element: part(<QuickActionsPage />) },
      { path: 'styleguide', element: part(<StyleguidePage />) },

      // СТОРОЖ: из /cms не выпадают к гостю.
      //
      // У ветки не было своего `*`, и любой неизвестный адрес под /cms
      // доезжал до корневой ветки, где `*` уводит на `/` — то есть на вход
      // гостя, а с живой сессией сразу на /home. Так «PMS» из меню админа
      // открывал гостевую главную. Возврат в дашборд — на своей территории.
      { path: '*', element: <Navigate to={cmsPath('/dashboard')} replace /> },
    ],
  },
  /*
    Шкала персонала теперь ОДНА — она внутри `AppShell`. Раньше трекер
    навешивал `StaffScale` на маршрут, а панель — внутри оболочки; два места
    для одной шкалы означали бы, что однажды они разъедутся.
  */
  { path: '/tracker', element: <TrackerScreen /> },
  // Рабочее место ресепшена: диалоги с гостями, переписка, карточка гостя.
  { path: '/tracker/desk', element: <DeskScreen /> },
  {
    // Deep link to one order: the board stays mounted underneath and opens the
    // detail sheet, so the URL is shareable without a second data source.
    path: '/tracker/order/:id',
    element: <TrackerScreen />,
  },
];

const shellBranch: RouteObject = {
  element: (
    // `fallback` — вход на месте: на хосте отеля адрес панели и адрес входа
    // совпали (`/admin`), и увод на `/login` дал бы петлю.
    <RequireAuth fallback={HOST_ROLE === 'hotel' ? part(<LoginPage />) : undefined}>
      {part(<AppShell />)}
    </RequireAuth>
  ),
  children: shellChildren,
};

/**
 * Дерево витрины — ЭКСПОРТИРУЕТСЯ ради показа бренда.
 *
 * Показ рисует настоящие экраны гостя и берёт их адреса ОТСЮДА: выписав
 * список у себя, он перестал бы замечать новый экран ровно в тот день, когда
 * его добавят. Именно этим и болел прежний показ — он был собран руками.
 */
export const guestBranch: RouteObject =
  {
    path: '/',
    element: part(<GuestRoot />),
    children: [
      { index: true, element: part(<EntryPage />) },
      // QR deep link — creates the session for the scanned room right away.
      { path: 'r/:roomNumber', element: part(<EntryPage />) },
      {
        element: part(<GuestLayout />),
        children: [
          { path: 'home', element: part(<HomePage />) },
          // Every catalog is the same screen with a different offering type;
          // there is deliberately no separate page component per type.
          // Плоских каталогов отеля больше нет: и блюда, и заявки, и слоты
          // живут внутри заведения, которое их исполняет. Старые ссылки уводим
          // на главную, а не в 404 — они могли остаться в закладке или в
          // переписке.
          //
          // `info` — исключение по устройству данных, а не по недоделке: у
          // инфо-раздела нет сервиса-исполнителя (некому исполнять «пароль от
          // wi-fi»), это раздел ОТЕЛЯ, и он остаётся плоским.
          { path: 'menu', element: <Navigate to="/home" replace /> },
          { path: 'services', element: <Navigate to="/home" replace /> },
          { path: 'slots', element: <Navigate to="/home" replace /> },
          { path: 'info', element: part(<CatalogPage type="info" />) },
          // Showcase levels 2 and 3: a group's venue list, and a venue's own catalog.
          { path: 'category/:group', element: part(<VenueListPage />) },
          { path: 'venue/:code', element: part(<VenuePage />) },
          { path: 'cart', element: part(<CartPage />) },
          { path: 'chat', element: part(<ChatPage />) },
          // Управление номером. Гейт по модулю отеля живёт НА СЕРВЕРЕ:
          // маршрут доступен, но данные без модуля не отдаются (403).
          // Скрытый на клиенте пункт — удобство, а не защита.
          { path: 'room', element: part(<RoomPage />) },
          { path: 'search', element: part(<SearchPage />) },
          { path: 'orders', element: part(<OrdersPage />) },
          { path: 'orders/:id', element: part(<OrderStatusPage />) },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  };

/**
 * Старый адрес раздела CMS — на новый, С СОХРАНЕНИЕМ хвоста.
 *
 * `/cms/services/7?tab=menu` обязан приводить ровно туда же в `/admin`:
 * ссылка из письма или закладка ведёт в конкретный раздел, и высадка в
 * дашборд означала бы «адрес жив, но не тот».
 */
/**
 * Корень панели решает по ПРАВАМ, а не уводит всех в дашборд.
 *
 * Здесь стоял безусловный `<Navigate to='/dashboard'>`, и на хосте отеля он
 * побеждал посадку после входа: вход там рисуется НА МЕСТЕ, внутри маршрута
 * `/admin`, и как только `RequireAuth` пускает дальше, индексный редирект
 * срабатывает при рендере — раньше, чем успевает отработать императивный
 * `navigate()` со страницы входа. Линейный сотрудник уезжал в раздел, куда ему
 * нельзя, и видел отказ.
 *
 * Локально это не воспроизводилось: дев-сервер работает в режиме одного хоста,
 * где вход живёт отдельной страницей `/login` и гонки нет вовсе.
 *
 * Тот же путь — это ещё и закладка на `/admin`: она обязана приводить человека
 * туда, где он работает, а не туда, где ему откажут.
 */
function CmsHome() {
  const { user, isAuthenticated } = useAuth();
  // Пока права неизвестны, не решаем: пустой кадр дешевле неверного адреса.
  if (isAuthenticated && !user) return null;
  return <Navigate to={homePathFor(user)} replace />;
}

function LegacyCmsRedirect() {
  const location = useLocation();
  const tail = location.pathname.slice('/cms'.length);
  return <Navigate to={`${cmsPath(tail)}${location.search}${location.hash}`} replace />;
}

/** Корень платформы: лендинг и наша консоль. Гостя и CMS здесь нет. */
const platformRoutes: RouteObject[] = [
  { path: '/', element: part(<LandingPage />) },
  { path: '/admin', element: part(<AdminApp />) },
  { path: '/platform', element: <Navigate to="/admin" replace /> },
  { path: '/dev/theme', element: part(<DevThemePage />) },
  // Пришли по старой ссылке — объясняем адрес, а не показываем мёртвую форму
  // ввода номера, которая раньше отвечала ошибкой сервера на нажатие.
  { path: '/login', element: <WrongHostNotice /> },
  { path: '/cms/*', element: <WrongHostNotice /> },
  { path: '/r/:roomNumber', element: <WrongHostNotice /> },
  { path: '/home', element: <WrongHostNotice /> },
  { path: '/tracker', element: <WrongHostNotice /> },
  { path: '*', element: <Navigate to="/" replace /> },
];

/** Адрес отеля: гость, его CMS в `/admin`, доска. Нашей консоли здесь нет. */
const hotelRoutes: RouteObject[] = [
  // Старые адреса панели — ПОСТОЯННЫЕ редиректы: они в письмах, в закладках и
  // в переписке, и 404 на них читался бы как «панель отеля пропала».
  { path: '/login', element: <Navigate to={CMS_ROOT} replace /> },
  { path: '/cms/*', element: <LegacyCmsRedirect /> },
  { path: '/dev/theme', element: part(<DevThemePage />) },
  shellBranch,
  guestBranch,
];

/**
 * Домена нет — старое поведение одного хоста: гость в корне, CMS на `/cms`,
 * консоль на `/admin`. Это режим машины разработчика.
 */
const singleHostRoutes: RouteObject[] = [
  { path: '/login', element: part(<LoginPage />) },
  { path: '/dev/theme', element: part(<DevThemePage />) },
  { path: '/admin', element: part(<AdminApp />) },
  { path: '/platform', element: <Navigate to="/admin" replace /> },
  shellBranch,
  guestBranch,
];

export const router = createBrowserRouter(
  HOST_ROLE === 'platform'
    ? platformRoutes
    : HOST_ROLE === 'hotel'
      ? hotelRoutes
      : singleHostRoutes,
);