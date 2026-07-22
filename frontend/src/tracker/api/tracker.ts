/**
 * Tracker endpoints — one function per route in `docs/tracker-api-contract.md`.
 *
 * The staff JWT is reused as-is: the tracker is the same principal as the CMS,
 * so it goes through `@/api/client` (bearer + `X-Hotel-Subdomain` + 401 bounce)
 * instead of growing a client of its own.
 */

import { api, HOTEL_SUBDOMAIN, tokenStorage } from '@/api/client';
import type {
  StatusChangePayload,
  TrackerBoard,
  TrackerChatSnapshot,
  TrackerChatThread,
  TrackerOrder,
  TrackerPointsResponse,
  TrackerScope,
} from './types';

/** Server-side localization is driven by `Accept-Language`, as in the CMS. */
function langHeaders(language?: string): Record<string, string> | undefined {
  return language ? { 'Accept-Language': language } : undefined;
}

export function fetchTrackerPoints(language?: string): Promise<TrackerPointsResponse> {
  return api.get<TrackerPointsResponse>('/tracker/points', {
    headers: langHeaders(language),
  });
}

export function fetchTrackerBoard(
  point: string,
  scope: TrackerScope,
  language?: string,
): Promise<TrackerBoard> {
  return api.get<TrackerBoard>('/tracker/orders', {
    query: { point, scope },
    headers: langHeaders(language),
  });
}

/**
 * One order, straight from the server.
 *
 * Used only for a COLD deep link (`/tracker/order/:id` opened from a message or
 * a bookmark): during normal work the order already travels in the board
 * snapshot, and a card tap must not cost a request.
 *
 * `403 point_not_assigned` / `404` come back as ordinary `ApiError`s.
 */
export function fetchTrackerOrder(orderId: string, language?: string): Promise<TrackerOrder> {
  return api.get<TrackerOrder>(`/tracker/order/${orderId}`, {
    headers: langHeaders(language),
  });
}

export function acceptTrackerOrder(orderId: string, language?: string): Promise<TrackerOrder> {
  return api.post<TrackerOrder>(`/tracker/order/${orderId}/accept`, {}, {
    headers: langHeaders(language),
  });
}

export function changeTrackerOrderStatus(
  orderId: string,
  payload: StatusChangePayload,
  language?: string,
): Promise<TrackerOrder> {
  return api.post<TrackerOrder>(
    `/tracker/order/${orderId}/status`,
    { status: payload.status, comment: payload.comment ?? '' },
    { headers: langHeaders(language) },
  );
}

export function cancelTrackerOrder(
  orderId: string,
  reason: string,
  language?: string,
): Promise<TrackerOrder> {
  return api.post<TrackerOrder>(`/tracker/order/${orderId}/cancel`, { reason }, {
    headers: langHeaders(language),
  });
}

/**
 * WS URL for the board.
 *
 * `hotel` and `lang` travel as query params because a WebSocket handshake
 * carries no custom headers (contract §5). The trailing slash matches how the
 * ASGI router registers routes in this project (`ws/guest/order/<id>/`).
 */
export function trackerSocketUrl(pointCode: string, language?: string): string | null {
  const token = tokenStorage.get();
  if (!token) return null;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const params = new URLSearchParams({ token, hotel: HOTEL_SUBDOMAIN });
  if (language) params.set('lang', language);
  return `${protocol}//${window.location.host}/ws/tracker/${encodeURIComponent(
    pointCode,
  )}/?${params.toString()}`;
}

/* ── Chat (staff side) ─────────────────────────────────────────────────── */

/** Threads of the hotel — last message + unread count (contract §3). */
export function fetchChatThreads(language?: string): Promise<TrackerChatThread[]> {
  return api.get<TrackerChatThread[]>('/tracker/chat/threads', {
    headers: langHeaders(language),
  });
}

/** One thread + its messages; `mine` is computed for the staff side. */
export function fetchChatThread(
  threadId: string,
  language?: string,
): Promise<TrackerChatSnapshot> {
  return api.get<TrackerChatSnapshot>(`/tracker/chat/threads/${threadId}`, {
    headers: langHeaders(language),
  });
}

/** Reply in a thread; the response is the fresh full snapshot, not a delta. */
export function sendChatReply(
  threadId: string,
  body: string,
  language?: string,
): Promise<TrackerChatSnapshot> {
  return api.post<TrackerChatSnapshot>(
    `/tracker/chat/threads/${threadId}`,
    { body },
    { headers: langHeaders(language) },
  );
}

/** Mark the guest's messages in a thread as read. */
export function markChatThreadRead(
  threadId: string,
  language?: string,
): Promise<TrackerChatSnapshot> {
  return api.post<TrackerChatSnapshot>(
    `/tracker/chat/threads/${threadId}/read`,
    {},
    { headers: langHeaders(language) },
  );
}

/**
 * WS URL for one staff thread: `ws/staff/chat/{thread_id}/`. Same snapshot
 * contract as the guest socket, only scoped to the hotel's thread (codes 4401
 * token, 4403 foreign thread, 4404 hotel).
 */
export function staffChatSocketUrl(threadId: string, language?: string): string | null {
  const token = tokenStorage.get();
  if (!token) return null;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const params = new URLSearchParams({ token, hotel: HOTEL_SUBDOMAIN });
  if (language) params.set('lang', language);
  return `${protocol}//${window.location.host}/ws/staff/chat/${encodeURIComponent(
    threadId,
  )}/?${params.toString()}`;
}
