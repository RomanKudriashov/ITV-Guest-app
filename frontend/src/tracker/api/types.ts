/**
 * Tracker API types — mirror of `docs/tracker-api-contract.md`.
 *
 * The board order is a superset of the guest order (§3 of the contract): the
 * same object plus what the executor needs. Reusing `GuestOrder` is deliberate —
 * the timeline component and the money helpers keep working unchanged.
 */

import type { GuestOrder } from '@/guest/api/types';

export type TrackerScope = 'active' | 'history';

export interface TrackerPoint {
  id: string;
  code: string;
  title: string;
  kind?: string;
  /** Staff level on this point ("lead", "member", …) — informational. */
  level?: string;
  active_count?: number;
  new_count?: number;
}

export interface TrackerPointsResponse {
  points: TrackerPoint[];
}

export interface TrackerPointRef {
  id: string;
  code: string;
  title: string;
}

export interface TrackerAssignee {
  id: string;
  name: string;
}

/** Where the order may go from its current status — computed by the server. */
export interface TrackerNextStatus {
  code: string;
  title: string;
  color_token?: string;
}

export interface TrackerOrder extends GuestOrder {
  execution_point: TrackerPointRef;
  assignee: TrackerAssignee | null;
  accepted_at: string | null;
  /** How long the order has been waiting, minutes. */
  waiting_minutes: number;
  /** Waiting longer than the point's threshold. */
  is_overdue: boolean;
  next_statuses: TrackerNextStatus[];
  can_cancel: boolean;
}

export interface TrackerColumn {
  code: string;
  title: string;
  orders: TrackerOrder[];
}

export interface TrackerBoard {
  point: TrackerPointRef;
  scope: TrackerScope;
  server_time: string;
  /** Built from the hotel's status preset — never hard-coded on the client. */
  columns: TrackerColumn[];
}

/** WebSocket envelope — full snapshots only, never deltas (contract §5). */
export interface TrackerSnapshotMessage {
  type: 'tracker.snapshot';
  /** `connected` for the first snapshot, otherwise the event that fired. */
  event?: string;
  order_id?: string;
  board: TrackerBoard;
}

export interface TrackerPingMessage {
  type: 'ping';
}

export type TrackerSocketMessage =
  | TrackerSnapshotMessage
  | TrackerPingMessage
  | { type: string };

export interface StatusChangePayload {
  status: string;
  comment?: string;
}
