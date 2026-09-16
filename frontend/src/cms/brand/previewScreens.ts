/**
 * ВОСЕМЬ ЭКРАНОВ ПОКАЗА — И ЧТО КАЖДОМУ НУЖНО.
 *
 * Список ведётся ЗДЕСЬ, а не расползается по компоненту: показ обязан
 * рисоваться настоящими экранами витрины, и единственное, что он про них знает,
 * — по какому адресу их открыть и какие данные положить в кэш.
 *
 * Чата в списке нет намеренно: без живого гостя это пустой тред, а чужую
 * переписку на экране настройки показывать нельзя (журнал решений, пункт 11).
 * Когда в волне 9 гостевая сторона чата станет одним диалогом, решение
 * принимается заново.
 */

import { guestKeys } from '@/guest/api/queryKeys';

export type PreviewScreenId =
  | 'entry'
  | 'home'
  | 'venues'
  | 'catalog'
  | 'item'
  | 'cart'
  | 'request'
  | 'room';

export interface PreviewScreen {
  id: PreviewScreenId;
  /** Ключ перевода названия в переключателе. */
  labelKey: string;
  /**
   * Адрес внутри гостевой витрины — показ открывает ИМЕННО его.
   *
   * `:venue` подставляется КОДОМ ЗАВЕДЕНИЯ ИЗ ОТВЕТА СЕРВЕРА. Зашить код
   * нельзя: он свой у каждого отеля, и «кухня» работала бы ровно на нашем
   * стенде, а чужому отелю показывала бы «заведение не найдено».
   */
  route: string;
  /**
   * Какие экраны показа спрашивать у сервера. Пусто — экран данных не требует
   * (вход рисуется до всякой загрузки).
   */
  payloads: PreviewPayloadId[];
  /** Рисуется ли экран внутри гостевой оболочки (шапка/нижнее меню). */
  inShell: boolean;
}

/**
 * Адрес экрана заведения. Код подставляет показ — из блока `venue` в ответе
 * сервера, который сам выбрал первое гостевое заведение отеля.
 */
export const VENUE_ROUTE = '/venue/:venue';

/**
 * Адрес, по которому открывать экран: с подставленным кодом заведения.
 *
 * `null` — заведения нет вовсе. Открывать при этом `/venue/` нельзя: адрес не
 * совпадёт ни с одним маршрутом, и показ вместо честного «у отеля нет
 * заведений» показал бы пустой экран неизвестно чего.
 */
export function resolveRoute(screen: PreviewScreen, venue: string | null): string | null {
  if (!screen.route.includes(':venue')) return screen.route;
  return venue ? screen.route.replace(':venue', venue) : null;
}

export type PreviewPayloadId = 'home' | 'venues' | 'catalog' | 'item' | 'locations' | 'room';

/** Куда класть ответ сервера, чтобы настоящий экран нашёл его как свой. */
export function cacheKeyFor(payload: PreviewPayloadId, language: string, point?: string) {
  switch (payload) {
    case 'home':
      return guestKeys.home(language);
    case 'venues':
      return guestKeys.venues('restaurants', language);
    case 'catalog':
      return guestKeys.catalog('product', language, point);
    case 'item':
      // Ключ карточки требует идентификатор — показ подставляет полученный.
      return null;
    case 'locations':
      // Корзина показа пуста — места без позиций, тем же ключом, что спросит экран.
      return guestKeys.locations(language, '');
    case 'room':
      return guestKeys.room;
  }
}

export const PREVIEW_SCREENS: PreviewScreen[] = [
  // Вход — единственное место, где логотип виден телефонному гостю в полный
  // размер. Данных не требует: экран живёт до всякой загрузки.
  { id: 'entry', labelKey: 'brand.preview.screen.entry', route: '/', payloads: [], inShell: false },
  { id: 'home', labelKey: 'brand.preview.screen.home', route: '/home', payloads: ['home'], inShell: true },
  {
    id: 'venues',
    labelKey: 'brand.preview.screen.venues',
    route: '/category/restaurants',
    payloads: ['home', 'venues'],
    inShell: true,
  },
  {
    id: 'catalog',
    labelKey: 'brand.preview.screen.catalog',
    route: VENUE_ROUTE,
    payloads: ['home', 'catalog'],
    inShell: true,
  },
  {
    id: 'item',
    labelKey: 'brand.preview.screen.item',
    route: VENUE_ROUTE,
    payloads: ['home', 'catalog', 'item'],
    inShell: true,
  },
  // Корзина и оформление — ОДИН экран витрины с двумя оболочками, а не два:
  // делить показ там, где код не делится, значило бы показывать выдуманную
  // границу.
  {
    id: 'cart',
    labelKey: 'brand.preview.screen.cart',
    route: '/cart',
    payloads: ['home', 'locations'],
    inShell: true,
  },
  {
    id: 'request',
    labelKey: 'brand.preview.screen.request',
    route: VENUE_ROUTE,
    payloads: ['home', 'catalog'],
    inShell: true,
  },
  {
    id: 'room',
    labelKey: 'brand.preview.screen.room',
    route: '/room',
    payloads: ['home', 'room'],
    inShell: true,
  },
];
