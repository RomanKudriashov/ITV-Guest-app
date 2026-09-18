import { Navigate, createBrowserRouter, useLocation, type RouteObject } from 'react-router-dom';

import { RequireAuth } from '@/auth';
import { AppShell } from '@/layouts/AppShell';
import { LoginPage } from '@/pages/LoginPage';
import { CategoryEditorPage } from '@/pages/category/CategoryEditorPage';
import { ItemEditorPage } from '@/pages/item/ItemEditorPage';
import { NotificationsPage } from '@/pages/notifications/NotificationsPage';
import { OrdersPage as CmsOrdersPage } from '@/cms/orders/OrdersPage';
import { RoomsPage } from '@/pages/hotel/RoomsPage';
import { StaffPage } from '@/pages/hotel/StaffPage';
import { BrandPage } from '@/cms/brand/BrandPage';
import { ServicesPage } from '@/cms/services/ServicesPage';
import { ServiceWorkspacePage } from '@/cms/services/ServiceWorkspacePage';
import { SettingsPage } from '@/cms/settings/SettingsPage';
import { DashboardPage } from '@/cms/dashboard/DashboardPage';
import { StyleguidePage } from '@/cms/styleguide/StyleguidePage';
import { AnalyticsPage } from '@/cms/analytics/AnalyticsPage';
import { ReviewsPage } from '@/cms/reviews/ReviewsPage';
import { MarketingPage } from '@/cms/marketing/MarketingPage';
import { QuickActionsPage } from '@/cms/quickActions/QuickActionsPage';
import { ModulePendingPage } from '@/pages/ModulePendingPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { RoomControlPage } from '@/cms/roomControl/RoomControlPage';
import { DictionariesPage } from '@/cms/dictionaries/DictionariesPage';
import { AdminApp } from '@/admin/AdminApp';
import App from '@/App';

import { useTranslation } from 'react-i18next';

import { ScreenBoundary } from '@/components/ScreenBoundary';
import { TrackerPage } from '@/tracker/pages/TrackerPage';
import { ReceptionDeskPage } from '@/tracker/pages/ReceptionDeskPage';

import { CMS_ROOT, HOST_ROLE, cmsPath } from '@/app/hostRole';
import { LandingPage } from '@/landing/LandingPage';
import { WrongHostNotice } from '@/pages/WrongHostNotice';

import { GuestRoot } from '@/guest/GuestRoot';
import { GuestLayout } from '@/guest/layout/GuestLayout';
import { EntryPage } from '@/guest/pages/EntryPage';
import { HomePage } from '@/guest/pages/HomePage';
import { CatalogPage } from '@/guest/pages/CatalogPage';
import { VenuePage } from '@/guest/pages/VenuePage';
import { VenueListPage } from '@/guest/pages/VenueListPage';
import { CartPage } from '@/guest/pages/CartPage';
import { ChatPage } from '@/guest/pages/ChatPage';
import { OrdersPage } from '@/guest/pages/OrdersPage';
import { RoomPage } from '@/guest/pages/RoomPage';
import { SearchPage } from '@/guest/pages/SearchPage';
import { OrderStatusPage } from '@/guest/pages/OrderStatusPage';
import { useAuth } from '@/auth';
import { homePathFor } from '@/auth/home';

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
      <ReceptionDeskPage />
    </ScreenBoundary>
  );
}

function TrackerScreen() {
  const { t } = useTranslation();
  return (
    <ScreenBoundary message={t('state.crashed')} actionLabel={t('state.reload')}>
      <TrackerPage />
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
      { path: 'dashboard', element: <DashboardPage /> },
      // Профиль сотрудника: его собственные входы. Не в настройках отеля —
      // те открыты только администратору, а сессии есть у каждого.
      { path: 'profile', element: <ProfilePage /> },

      // Структура отеля: сервисы верхним уровнем, меню — внутри сервиса.
      { path: 'services', element: <ServicesPage /> },
      { path: 'services/:id', element: <ServiceWorkspacePage /> },
      { path: 'rooms', element: <RoomsPage /> },
      { path: 'staff', element: <StaffPage /> },

      // Редакторы позиции и категории — общие, вызываются из меню сервиса.
      { path: 'menu', element: <Navigate to={cmsPath('/services')} replace /> },
      { path: 'menu/categories/new', element: <CategoryEditorPage /> },
      { path: 'menu/categories/:id', element: <CategoryEditorPage /> },
      { path: 'menu/items/new', element: <ItemEditorPage /> },
      { path: 'menu/items/:id', element: <ItemEditorPage /> },

      // Оформление: бренд и витрина — один раздел.
      { path: 'brand', element: <BrandPage /> },
      { path: 'analytics', element: <AnalyticsPage /> },
      { path: 'reviews', element: <ReviewsPage /> },

      // Настройки: сюда растворилась «Коммерция» и переехал справочник локаций.
      { path: 'settings', element: <SettingsPage /> },
      { path: 'notifications', element: <NotificationsPage /> },
      // Заказы: разбор по всем заведениям. Раздел сам режется по
      // подведомственным точкам, поэтому маршрут общий для админа и
      // управляющего — линейного сюда не пускает гейт CMS.
      //
      // Имя импорта с приставкой: `OrdersPage` уже занят ГОСТЕВЫМ экраном
      // «мои заказы», и это разные вещи — гость смотрит свои, отель смотрит
      // все.
      { path: 'orders', element: <CmsOrdersPage /> },
      { path: 'dictionaries', element: <DictionariesPage /> },

      // Модульные разделы: пункт в навигации появляется только с модулем,
      // но маршрут существует всегда — иначе прямая ссылка ломалась бы молча.
      { path: 'marketing', element: <MarketingPage /> },
      { path: 'room-control', element: <RoomControlPage /> },
      // Эти три навигация показывает, а экранов под них ещё нет. Без маршрута
      // адрес проваливался в корневую ветку и уезжал на гостевую главную —
      // админ из своей панели попадал к гостю.
      { path: 'pms', element: <ModulePendingPage moduleKey="pms" /> },
      { path: 'payments', element: <ModulePendingPage moduleKey="payments" /> },
      { path: 'mobile-key', element: <ModulePendingPage moduleKey="mobileKey" /> },

      // Служебное: витрина отдельным адресом больше не нужна (слита с брендом),
      // старые ссылки уводим туда же, а не в 404.
      { path: 'showcase', element: <Navigate to={cmsPath('/brand')} replace /> },
      { path: 'commerce', element: <Navigate to={cmsPath('/settings')} replace /> },
      { path: 'locations', element: <Navigate to={cmsPath('/settings')} replace /> },
      { path: 'departments', element: <Navigate to={cmsPath('/services')} replace /> },
      { path: 'quick-actions', element: <QuickActionsPage /> },
      { path: 'styleguide', element: <StyleguidePage /> },

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
    <RequireAuth fallback={HOST_ROLE === 'hotel' ? <LoginPage /> : undefined}>
      <AppShell />
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
    element: <GuestRoot />,
    children: [
      { index: true, element: <EntryPage /> },
      // QR deep link — creates the session for the scanned room right away.
      { path: 'r/:roomNumber', element: <EntryPage /> },
      {
        element: <GuestLayout />,
        children: [
          { path: 'home', element: <HomePage /> },
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
          { path: 'info', element: <CatalogPage type="info" /> },
          // Showcase levels 2 and 3: a group's venue list, and a venue's own catalog.
          { path: 'category/:group', element: <VenueListPage /> },
          { path: 'venue/:code', element: <VenuePage /> },
          { path: 'cart', element: <CartPage /> },
          { path: 'chat', element: <ChatPage /> },
          // Управление номером. Гейт по модулю отеля живёт НА СЕРВЕРЕ:
          // маршрут доступен, но данные без модуля не отдаются (403).
          // Скрытый на клиенте пункт — удобство, а не защита.
          { path: 'room', element: <RoomPage /> },
          { path: 'search', element: <SearchPage /> },
          { path: 'orders', element: <OrdersPage /> },
          { path: 'orders/:id', element: <OrderStatusPage /> },
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
  { path: '/', element: <LandingPage /> },
  { path: '/admin', element: <AdminApp /> },
  { path: '/platform', element: <Navigate to="/admin" replace /> },
  { path: '/dev/theme', element: <App /> },
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
  { path: '/dev/theme', element: <App /> },
  shellBranch,
  guestBranch,
];

/**
 * Домена нет — старое поведение одного хоста: гость в корне, CMS на `/cms`,
 * консоль на `/admin`. Это режим машины разработчика.
 */
const singleHostRoutes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  { path: '/dev/theme', element: <App /> },
  { path: '/admin', element: <AdminApp /> },
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