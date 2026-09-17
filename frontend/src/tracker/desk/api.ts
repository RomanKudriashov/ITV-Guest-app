import { api } from '@/api/client';
import type {
  CartQuote,
  CreateOrderPayload,
  GuestLocation,
  GuestOrder,
  ItemDetail,
  GuestCatalog,
} from '@/guest/api/types';

/**
 * Заказ от имени гостя: те же каталог, места и расчёт, что у гостя, но через
 * ручки рабочего места (только ресепшену и администратору).
 */

export interface DeskVenue {
  /** Код заведения — `service_code` корзины. */
  code: string;
  /** Код исполнителя — фильтр каталога. */
  point: string;
  title: string;
  type: string;
}

function lang(language?: string): Record<string, string> {
  return language ? { 'Accept-Language': language } : {};
}

export function fetchDeskVenues(language?: string): Promise<{ venues: DeskVenue[] }> {
  return api.get('/tracker/desk/venues', { headers: lang(language) });
}

export function fetchDeskCatalog(point: string, language?: string): Promise<GuestCatalog> {
  return api.get('/tracker/desk/catalog', {
    headers: lang(language),
    query: { point, type: 'product' },
  });
}

export function fetchDeskItem(itemId: string, language?: string): Promise<ItemDetail> {
  return api.get(`/tracker/desk/item/${itemId}`, { headers: lang(language) });
}

export function fetchDeskLocations(
  threadId: string,
  itemIds: string[],
  language?: string,
): Promise<{ room: string | null; locations: GuestLocation[] }> {
  return api.get(`/tracker/desk/threads/${threadId}/locations`, {
    headers: lang(language),
    query: { items: itemIds.join(',') },
  });
}

export function quoteDeskCart(threadId: string, payload: CreateOrderPayload): Promise<CartQuote> {
  return api.post(`/tracker/desk/threads/${threadId}/quote`, payload);
}

export interface DeskPoint {
  code: string;
  title: string;
  /** Как отдел называется для гостя — его и произносим в чате. */
  public_title: string;
}

export function fetchDeskPoints(language?: string): Promise<{ points: DeskPoint[] }> {
  return api.get('/tracker/desk/points', { headers: lang(language) });
}

/** Передать задачу отделу: заказ по его доске, переписка остаётся у ресепшена. */
export function handOverTask(
  threadId: string,
  point: string,
  text: string,
): Promise<GuestOrder & { point_title: string }> {
  return api.post(`/tracker/desk/threads/${threadId}/task`, { point, text });
}

export function placeDeskOrder(
  threadId: string,
  payload: CreateOrderPayload,
  idempotencyKey: string,
): Promise<GuestOrder> {
  return api.post(`/tracker/desk/threads/${threadId}/order`, payload, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}
